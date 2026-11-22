#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalDate:off - Standalone CI/local upstream sync utility that runs before dependency install.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const NIGHTLY_TAG_PATTERN = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;

export const AUTO_REGENERATABLE_CONFLICT_FILES = new Set<string>([
  "pnpm-lock.yaml",
  "apps/web/src/routeTree.gen.ts",
]);

export interface UpstreamSyncState {
  readonly upstreamRepo: string;
  readonly channel: "nightly" | "stable";
  readonly lastSyncedTag: string | null;
  readonly lastSyncedSha: string | null;
  readonly lastSyncedAt: string | null;
}

export interface GitHubReleaseSummary {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly published_at?: string | null;
  readonly target_commitish?: string;
  readonly html_url?: string;
}

export interface ConflictResolutionPlan {
  readonly autoResolvable: boolean;
  readonly generatedFiles: ReadonlyArray<string>;
  readonly manualFiles: ReadonlyArray<string>;
}

export function selectLatestUpstreamNightly(
  releases: ReadonlyArray<GitHubReleaseSummary>,
): GitHubReleaseSummary | undefined {
  let newest: GitHubReleaseSummary | undefined;
  let newestTimestamp = Number.NEGATIVE_INFINITY;

  for (const release of releases) {
    if (release.draft) continue;
    if (!NIGHTLY_TAG_PATTERN.test(release.tag_name)) continue;
    if (!release.published_at) continue;
    const publishedAtMs = Date.parse(release.published_at);
    if (!Number.isFinite(publishedAtMs)) continue;
    if (publishedAtMs > newestTimestamp) {
      newest = release;
      newestTimestamp = publishedAtMs;
    }
  }

  return newest;
}

export function planConflictResolution(
  conflictedFiles: ReadonlyArray<string>,
): ConflictResolutionPlan {
  const generatedFiles: string[] = [];
  const manualFiles: string[] = [];

  for (const rawFile of conflictedFiles) {
    const normalized = rawFile.replaceAll("\\", "/").trim();
    if (!normalized) continue;
    if (AUTO_REGENERATABLE_CONFLICT_FILES.has(normalized)) {
      generatedFiles.push(normalized);
    } else {
      manualFiles.push(normalized);
    }
  }

  return {
    autoResolvable: manualFiles.length === 0,
    generatedFiles,
    manualFiles,
  };
}

export function needsUpstreamSync(
  state: UpstreamSyncState,
  latest: GitHubReleaseSummary | undefined,
): boolean {
  if (!latest) return false;
  return state.lastSyncedTag !== latest.tag_name;
}

export function sanitizeBranchTag(tag: string): string {
  return tag.replace(/[^0-9A-Za-z._-]/g, "-");
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

async function fetchUpstreamReleases(
  repo: string,
  token?: string,
): Promise<GitHubReleaseSummary[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "t3codebot-upstream-sync",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch releases for ${repo}: HTTP ${response.status}`);
  }
  return (await response.json()) as GitHubReleaseSummary[];
}

async function resolveTagCommitSha(
  repo: string,
  tag: string,
  token?: string,
): Promise<string | undefined> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "t3codebot-upstream-sync",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { readonly sha?: string };
  return data.sha;
}

function readSyncState(stateFilePath: string): UpstreamSyncState {
  return JSON.parse(NodeFS.readFileSync(stateFilePath, "utf8")) as UpstreamSyncState;
}

function writeSyncState(stateFilePath: string, state: UpstreamSyncState): void {
  NodeFS.writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

async function main() {
  const rootDir = NodePath.resolve(import.meta.dirname, "..");
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const stateFilePath = NodePath.resolve(
    rootDir,
    getFlag(argv, "--state-file") ?? "packages/bot/upstream-sync.json",
  );
  const githubOutput = argv.includes("--github-output");

  if (subcommand === "check") {
    const state = readSyncState(stateFilePath);
    const repo = getFlag(argv, "--upstream-repo") ?? state.upstreamRepo;
    const explicitTag = getFlag(argv, "--tag")?.trim();
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

    let latest: GitHubReleaseSummary | undefined;
    if (explicitTag) {
      latest = {
        tag_name: explicitTag,
        published_at: new Date().toISOString(),
        html_url: `https://github.com/${repo}/releases/tag/${explicitTag}`,
      };
    } else {
      const releases = await fetchUpstreamReleases(repo, token);
      latest = selectLatestUpstreamNightly(releases);
    }

    const shouldSync = explicitTag ? true : needsUpstreamSync(state, latest);
    const upstreamSha = latest
      ? ((await resolveTagCommitSha(repo, latest.tag_name, token)) ?? "")
      : "";

    writeOutputs(
      [
        ["needs_sync", shouldSync ? "true" : "false"],
        ["upstream_repo", repo],
        ["upstream_tag", latest?.tag_name ?? ""],
        ["upstream_sha", upstreamSha],
        ["upstream_published_at", latest?.published_at ?? ""],
        ["upstream_url", latest?.html_url ?? ""],
        ["sync_branch", latest ? `sync/upstream-${sanitizeBranchTag(latest.tag_name)}` : ""],
        ["previous_synced_tag", state.lastSyncedTag ?? ""],
      ],
      githubOutput,
    );
    return;
  }

  if (subcommand === "record") {
    const tag = getFlag(argv, "--tag");
    const sha = getFlag(argv, "--sha");
    if (!tag || !sha) {
      throw new Error("Usage: bot-upstream-sync.ts record --tag <tag> --sha <sha>");
    }
    const current = readSyncState(stateFilePath);
    const updated: UpstreamSyncState = {
      ...current,
      lastSyncedTag: tag,
      lastSyncedSha: sha,
      lastSyncedAt: new Date().toISOString(),
    };
    writeSyncState(stateFilePath, updated);
    console.log(`Recorded upstream sync: ${tag} (${sha.slice(0, 12)})`);
    return;
  }

  if (subcommand === "classify-conflicts") {
    const filesArg = getFlag(argv, "--files") ?? "";
    const files = filesArg
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    const plan = planConflictResolution(files);
    writeOutputs(
      [
        ["auto_resolvable", plan.autoResolvable ? "true" : "false"],
        ["generated_files", plan.generatedFiles.join(",")],
        ["manual_files", plan.manualFiles.join(",")],
      ],
      githubOutput,
    );
    return;
  }

  throw new Error("Usage: bot-upstream-sync.ts <check|record|classify-conflicts> [options]");
}

if (import.meta.main) {
  await main();
}
