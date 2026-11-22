#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Standalone CI/local release version resolver that runs before dependency install.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type BotReleaseChannel = "nightly" | "stable";
export type BotReleaseSource = "upstream-sync" | "bot";

export interface ResolveBotReleaseVersionInput {
  readonly desktopPackageVersion: string;
  readonly botPackageVersion: string;
  readonly channel: BotReleaseChannel;
  readonly source: BotReleaseSource;
  readonly date: string;
  readonly existingTags: ReadonlyArray<string>;
  readonly explicitVersion?: string | undefined;
  readonly upstreamTag?: string | null | undefined;
  readonly upstreamSha?: string | null | undefined;
  readonly sha: string;
}

export interface BotReleaseVersionMetadata {
  readonly baseVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly botVersion: string;
  readonly upstreamLabel: string;
  readonly releaseName: string;
  readonly isPrerelease: boolean;
  readonly makeLatest: boolean;
}

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_VERSION_PATTERN = /^(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/;
const DATE_PATTERN = /^\d{8}$/;

/** Patch stride per upstream stable release (`[P * 100, P * 100 + 99]`) for monotonic 3-part SemVer updates. */
export const STABLE_REVISION_STRIDE = 100;

interface SemverCore {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSemverCore(raw: string): SemverCore | undefined {
  const core = raw
    .trim()
    .replace(/^v/, "")
    .replace(/[-+].*$/, "");
  const match = STABLE_VERSION_PATTERN.exec(core);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverCore(left: SemverCore, right: SemverCore): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function formatSemverCore(core: SemverCore): string {
  return `${core.major}.${core.minor}.${core.patch}`;
}

export function resolveUpstreamStableBaseVersion(
  desktopPackageVersion: string,
  upstreamTag?: string | null,
): string {
  const desktopCore = parseSemverCore(desktopPackageVersion);
  if (!desktopCore) {
    throw new Error(`Invalid apps/desktop/package.json version '${desktopPackageVersion}'.`);
  }

  const cleanTag = upstreamTag?.trim().replace(/^v/, "") ?? "";
  if (STABLE_VERSION_PATTERN.test(cleanTag)) {
    const tagCore = parseSemverCore(cleanTag);
    if (tagCore && compareSemverCore(tagCore, desktopCore) >= 0) {
      return formatSemverCore(tagCore);
    }
  }

  return formatSemverCore(desktopCore);
}

export function computeNextStableVersion(
  upstreamBaseVersion: string,
  existingTags: ReadonlyArray<string>,
): string {
  const base = parseSemverCore(upstreamBaseVersion);
  if (!base) {
    throw new Error(`Invalid upstream stable base version '${upstreamBaseVersion}'.`);
  }

  const slotStart = base.patch * STABLE_REVISION_STRIDE;
  const slotEnd = slotStart + STABLE_REVISION_STRIDE - 1;
  let maxPatchInSlot: number | undefined;

  for (const rawTag of existingTags) {
    const tag = rawTag.trim();
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (major !== base.major || minor !== base.minor) continue;
    if (patch < slotStart || patch > slotEnd) continue;
    if (maxPatchInSlot === undefined || patch > maxPatchInSlot) {
      maxPatchInSlot = patch;
    }
  }

  const nextPatch = maxPatchInSlot === undefined ? slotStart : maxPatchInSlot + 1;
  if (nextPatch > slotEnd) {
    throw new Error(
      `Stable revision slot exhausted for upstream ${formatSemverCore(base)} (max ${STABLE_REVISION_STRIDE} releases per upstream version). Pass an explicit --version or wait for the next upstream release.`,
    );
  }

  return `${base.major}.${base.minor}.${nextPatch}`;
}

export function computeNightlyBaseVersion(desktopPackageVersion: string): string {
  const core = parseSemverCore(desktopPackageVersion);
  if (!core) {
    throw new Error(`Invalid apps/desktop/package.json version '${desktopPackageVersion}'.`);
  }
  return `${core.major}.${core.minor}.${core.patch + 1}`;
}

export function computeNextDailyNightlySequence(
  baseVersion: string,
  date: string,
  existingTags: ReadonlyArray<string>,
): number {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid UTC release date '${date}'; expected YYYYMMDD.`);
  }
  const prefix = `v${baseVersion}-nightly.${date}.`;
  let maxSeq = 0;
  for (const rawTag of existingTags) {
    const tag = rawTag.trim();
    if (!tag.startsWith(prefix)) continue;
    const seqStr = tag.slice(prefix.length);
    if (!/^\d+$/.test(seqStr)) continue;
    const seq = Number.parseInt(seqStr, 10);
    if (Number.isSafeInteger(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }
  return maxSeq + 1;
}

export function formatUpstreamLabel(
  upstreamTag?: string | null,
  upstreamSha?: string | null,
): string {
  const cleanTag = upstreamTag?.trim();
  if (cleanTag) return cleanTag;
  const cleanSha = upstreamSha?.trim();
  if (cleanSha) return cleanSha.slice(0, 10);
  return "";
}

export function resolveBotReleaseVersion(
  input: ResolveBotReleaseVersionInput,
): BotReleaseVersionMetadata {
  const baseVersion =
    input.channel === "stable"
      ? resolveUpstreamStableBaseVersion(input.desktopPackageVersion, input.upstreamTag)
      : computeNightlyBaseVersion(input.desktopPackageVersion);
  const botVersion = input.botPackageVersion.trim() || "0.0.0";
  const upstreamLabel = formatUpstreamLabel(input.upstreamTag, input.upstreamSha);
  const explicit = input.explicitVersion?.trim().replace(/^v/, "") ?? "";

  let version: string;
  if (input.channel === "nightly") {
    if (explicit) {
      if (!NIGHTLY_VERSION_PATTERN.test(explicit)) {
        throw new Error(
          `Invalid nightly version '${explicit}'. Must match <X.Y.Z>-nightly.<YYYYMMDD>.<N> so desktop and CLI updaters keep the nightly channel.`,
        );
      }
      version = explicit;
    } else {
      const nextSeq = computeNextDailyNightlySequence(baseVersion, input.date, input.existingTags);
      version = `${baseVersion}-nightly.${input.date}.${nextSeq}`;
    }
  } else {
    if (explicit) {
      if (!STABLE_VERSION_PATTERN.test(explicit)) {
        throw new Error(
          `Invalid stable version '${explicit}'. Must match <X.Y.Z> without custom prerelease suffixes.`,
        );
      }
      version = explicit;
    } else {
      version = computeNextStableVersion(baseVersion, input.existingTags);
    }
  }

  const tag = `v${version}`;
  const shortSha = input.sha.trim().slice(0, 12);

  let releaseName: string;
  if (input.channel === "nightly") {
    if (input.source === "upstream-sync") {
      const detail = upstreamLabel
        ? `sync: ${upstreamLabel} · bot ${botVersion}`
        : `sync · bot ${botVersion}`;
      releaseName = `T3 Code Bot Nightly ${version} (${detail})`;
    } else {
      const detail = upstreamLabel
        ? `bot ${botVersion} · base ${upstreamLabel}`
        : `bot ${botVersion}${shortSha ? ` · ${shortSha}` : ""}`;
      releaseName = `T3 Code Bot Nightly ${version} (${detail})`;
    }
  } else {
    if (input.source === "upstream-sync") {
      const detail = upstreamLabel
        ? `sync: ${upstreamLabel} · bot ${botVersion}`
        : `sync · bot ${botVersion}`;
      releaseName = `T3 Code Bot v${version} (${detail})`;
    } else {
      const detail = upstreamLabel
        ? `bot ${botVersion} · base ${upstreamLabel}`
        : `bot ${botVersion}${shortSha ? ` · ${shortSha}` : ""}`;
      releaseName = `T3 Code Bot v${version} (${detail})`;
    }
  }

  return {
    baseVersion,
    version,
    tag,
    botVersion,
    upstreamLabel,
    releaseName,
    isPrerelease: input.channel === "nightly",
    makeLatest: input.channel === "stable",
  };
}

function getFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function listLocalGitTags(rootDir: string): ReadonlyArray<string> {
  const result = NodeChildProcess.spawnSync("git", ["tag", "--list"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git tag --list failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(NodeFS.readFileSync(filePath, "utf8")) as T;
}

function writeOutputs(entries: ReadonlyArray<readonly [string, string]>, githubOutput: boolean) {
  if (githubOutput) {
    const outputFile = process.env.GITHUB_OUTPUT;
    if (!outputFile) {
      throw new Error("GITHUB_OUTPUT is not set.");
    }
    const serialized = entries.map(([key, value]) => `${key}=${value}\n`).join("");
    NodeFS.appendFileSync(outputFile, serialized, "utf8");
    return;
  }
  for (const [key, value] of entries) {
    console.log(`${key}=${value}`);
  }
}

function defaultUtcDate(): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function main() {
  const rootDir = NodePath.resolve(import.meta.dirname, "..");
  const argv = process.argv.slice(2);
  const channelRaw = (getFlag(argv, "--channel") ?? "stable").trim();
  if (channelRaw !== "nightly" && channelRaw !== "stable") {
    throw new Error(`Unsupported channel '${channelRaw}'. Expected 'nightly' or 'stable'.`);
  }
  const sourceRaw = (getFlag(argv, "--source") ?? "bot").trim();
  if (sourceRaw !== "upstream-sync" && sourceRaw !== "bot") {
    throw new Error(`Unsupported source '${sourceRaw}'. Expected 'upstream-sync' or 'bot'.`);
  }

  const date = (getFlag(argv, "--date") ?? defaultUtcDate()).trim();
  const explicitVersion = getFlag(argv, "--version")?.trim() || undefined;
  const sha = (getFlag(argv, "--sha") ?? "").trim();
  const githubOutput = argv.includes("--github-output");

  const desktopPkg = readJsonFile<{ readonly version: string }>(
    NodePath.join(rootDir, "apps/desktop/package.json"),
  );
  const botPkg = readJsonFile<{ readonly version?: string }>(
    NodePath.join(rootDir, "packages/bot/package.json"),
  );
  const syncPath = NodePath.join(rootDir, "packages/bot/upstream-sync.json");
  const syncState = NodeFS.existsSync(syncPath)
    ? readJsonFile<{
        readonly lastSyncedTag?: string | null;
        readonly lastSyncedSha?: string | null;
      }>(syncPath)
    : undefined;

  const upstreamTag = getFlag(argv, "--upstream-tag")?.trim() || syncState?.lastSyncedTag;
  const existingTags = listLocalGitTags(rootDir);

  const meta = resolveBotReleaseVersion({
    desktopPackageVersion: desktopPkg.version,
    botPackageVersion: botPkg.version ?? "0.1.0",
    channel: channelRaw,
    source: sourceRaw,
    date,
    existingTags,
    explicitVersion,
    upstreamTag,
    upstreamSha: syncState?.lastSyncedSha,
    sha,
  });

  writeOutputs(
    [
      ["base_version", meta.baseVersion],
      ["version", meta.version],
      ["tag", meta.tag],
      ["bot_version", meta.botVersion],
      ["upstream_label", meta.upstreamLabel],
      ["release_name", meta.releaseName],
      ["is_prerelease", meta.isPrerelease ? "true" : "false"],
      ["make_latest", meta.makeLatest ? "true" : "false"],
    ],
    githubOutput,
  );
}

if (import.meta.main) {
  main();
}
