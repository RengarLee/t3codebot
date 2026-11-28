#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone CI/local footprint guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface FileDiffStat {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
}

export interface FootprintViolation {
  readonly path: string;
  readonly reason: "banned" | "unlisted" | "budget_exceeded";
  readonly detail: string;
}

export interface FootprintReport {
  readonly ok: boolean;
  readonly botOwnedFiles: ReadonlyArray<string>;
  readonly glueFiles: ReadonlyArray<FileDiffStat>;
  readonly violations: ReadonlyArray<FootprintViolation>;
}

const BOT_OWNED_PREFIXES = [
  "packages/bot/",
  "docs/bot/",
  ".agents/skills/verify-t3code/",
  "apps/web/src/components/bots/",
] as const;

const BOT_OWNED_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.github\/workflows\/bot-[^/]+\.yml$/,
  /^\.(?:agents|claude)\/rules\/bot-[^/]+\.md$/,
  /^scripts\/bot-[^/]+\.ts$/,
  /^scripts\/scenarios\/bot-[^/]+\.e2e\.ts$/,
];

const BOT_OWNED_EXACT = new Set<string>([
  "scripts/local-desktop.ts",
  "scripts/local-desktop.test.ts",
  "docs/operations/local-desktop.md",
  "apps/server/src/botHostAdapter.ts",
  "apps/server/src/botHostAdapter.test.ts",
  "apps/web/src/components/bots/BotThreadDetails.tsx",
  "apps/web/src/components/settings/BotsSettingsPanel.tsx",
  "apps/web/src/components/sidebar/SidebarBotsBar.tsx",
  "apps/web/src/routes/_chat.settings.bots.tsx",
  "evals/mcp-tool-use/botSessionCases.ts",
]);

const BANNED_UPSTREAM_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> =
  [
    {
      pattern: /^apps\/(?:web|mobile|desktop)\/src\/i18n\/translations\//,
      why: "Use packages/bot/src/web/i18n.ts instead of editing upstream translation catalogs.",
    },
    {
      pattern: /^packages\/contracts\/src\/settings\.ts$/,
      why: "Use packages/bot/src/web/preferences.ts or isolated bot storage instead of upstream ClientSettings.",
    },
    {
      pattern: /^apps\/server\/src\/persistence\/Migrations\.ts$/,
      why: "Store bot data in isolated <stateDir>/bots/bots.sqlite instead of upstream statev2.sqlite migrations.",
    },
    {
      pattern: /^\.github\/workflows\/(?:release|release-desktop|ci)\.yml$/,
      why: "Keep automation in dedicated .github/workflows/bot-*.yml files instead of modifying upstream workflows.",
    },
  ];

/**
 * Whitelisted upstream files allowed to carry minimal glue hooks, with per-file changed-line budgets.
 * `null` means auto-generated file (regenerated automatically on upstream sync).
 */
export const ALLOWED_UPSTREAM_GLUE_BUDGETS: Readonly<Record<string, number | null>> = {
  // Three command aliases expose the fork's local desktop workflow without upstream runtime changes.
  "package.json": 3,
  // Desktop dev shares its initial build with the server bundle watcher.
  "vite.config.ts": 11,
  "scripts/dev-runner.ts": 2,
  "scripts/dev-runner.test.ts": 10,
  // Local Windows packaging includes the prepared server bytecode in its file budget.
  "scripts/build-desktop-artifact.ts": 3,
  // Fork branch policy must be visible to agents starting at the repository root.
  "AGENTS.md": 4,
  // The fork's update-and-start action must be registered in the root project config.
  "t3.json": 6,
  // The shared eval runner registers Bot cases; the shared sender helper labels user turns in Bot sessions.
  "evals/mcp-tool-use/README.md": 4,
  "evals/mcp-tool-use/run.ts": 2,
  "packages/contracts/src/orchestrationV2.ts": 9,
  // The turn start passes the thread's creator so only agent-created threads label a person's message.
  "apps/server/src/orchestration-v2/ProviderTurnStartService.ts": 1,
  "packages/contracts/src/orchestrationV2.test.ts": 7,
  "apps/server/package.json": 6,
  "apps/server/src/server.ts": 10,
  "apps/mobile/src/features/settings/environment-maintenance.test.ts": 10,
  "apps/server/src/cli/update.test.ts": 4,
  "apps/web/package.json": 6,
  "apps/web/src/components/chat/MessagesTimeline.logic.ts": 10,
  "apps/web/src/components/chat/ThreadDetailsPanel.tsx": 6,
  "apps/web/src/components/Sidebar.tsx": 10,
  // Tailwind must scan packages/bot/src/web; a second utilities sheet would override app variants.
  "apps/web/src/index.css": 2,
  // Native panel registration, tab chrome, and reopening; Bot content stays in its adapter.
  "apps/web/src/rightPanelStore.ts": 6,
  "apps/web/src/closedViewStore.ts": 1,
  "apps/web/src/components/RightPanelTabs.tsx": 8,
  "apps/web/src/components/chat/RightPanelSurfaceContent.tsx": 10,
  // Bot references compose a sibling settle control without nesting a button inside a link.
  "apps/web/src/components/ThreadContextChip.tsx": 20,
  // Header and side-pane slots render the shared bot identity; lookup stays in components/bots.
  "apps/web/src/components/chat/ChatHeader.tsx": 8,
  "apps/web/src/components/chat/SideThreadPane.tsx": 10,
  // The existing lifecycle footer supplies a settle action alongside its unsettle state.
  "apps/web/src/components/chat/useThreadLifecycle.tsx": 13,
  "apps/web/src/components/settings/SettingsSidebarNav.tsx": 10,
  "apps/web/src/components/settings/settingsSearch.ts": 16,
  "packages/shared/src/cliRelease.ts": 4,
  "packages/ssh/src/tunnel.test.ts": 4,
  "apps/web/src/routeTree.gen.ts": null,
  "pnpm-lock.yaml": null,
};

function normalizeRepoPath(rawPath: string): string {
  return rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isBotOwnedPath(rawPath: string): boolean {
  const filePath = normalizeRepoPath(rawPath);
  if (BOT_OWNED_EXACT.has(filePath)) return true;
  if (BOT_OWNED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return true;
  return BOT_OWNED_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function parseGitNumstat(output: string): ReadonlyArray<FileDiffStat> {
  const stats: FileDiffStat[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [rawAdded, rawDeleted, ...rest] = parts;
    const filePath = normalizeRepoPath(rest.join("\t"));
    const added = rawAdded === "-" ? 0 : Number.parseInt(rawAdded ?? "0", 10);
    const deleted = rawDeleted === "-" ? 0 : Number.parseInt(rawDeleted ?? "0", 10);
    stats.push({
      path: filePath,
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0,
    });
  }
  return stats;
}

export function evaluateUpstreamFootprint(stats: ReadonlyArray<FileDiffStat>): FootprintReport {
  const botOwnedFiles: string[] = [];
  const glueFiles: FileDiffStat[] = [];
  const violations: FootprintViolation[] = [];

  for (const stat of stats) {
    const filePath = normalizeRepoPath(stat.path);
    if (isBotOwnedPath(filePath)) {
      botOwnedFiles.push(filePath);
      continue;
    }

    const banned = BANNED_UPSTREAM_PATTERNS.find(({ pattern }) => pattern.test(filePath));
    if (banned) {
      violations.push({
        path: filePath,
        reason: "banned",
        detail: banned.why,
      });
      continue;
    }

    if (!Object.hasOwn(ALLOWED_UPSTREAM_GLUE_BUDGETS, filePath)) {
      violations.push({
        path: filePath,
        reason: "unlisted",
        detail:
          "Upstream file is not in ALLOWED_UPSTREAM_GLUE_BUDGETS. Move logic into packages/bot/ or explicitly justify a tiny glue hook.",
      });
      continue;
    }

    const budget = ALLOWED_UPSTREAM_GLUE_BUDGETS[filePath];
    const changedLines = stat.added + stat.deleted;
    if (budget !== null && budget !== undefined && changedLines > budget) {
      violations.push({
        path: filePath,
        reason: "budget_exceeded",
        detail: `Changed ${changedLines} lines (+${stat.added}/-${stat.deleted}), exceeding thin-glue budget of ${budget} lines.`,
      });
      continue;
    }

    glueFiles.push({ ...stat, path: filePath });
  }

  return {
    ok: violations.length === 0,
    botOwnedFiles,
    glueFiles,
    violations,
  };
}

function runGit(rootDir: string, args: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function gitRefExists(rootDir: string, ref: string): boolean {
  const result = NodeChildProcess.spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return result.status === 0;
}

function resolveDefaultBaseRef(rootDir: string): string {
  const syncPath = NodePath.join(rootDir, "packages/bot/upstream-sync.json");
  if (NodeFS.existsSync(syncPath)) {
    const syncState = JSON.parse(NodeFS.readFileSync(syncPath, "utf8")) as {
      readonly lastSyncedTag?: string | null;
      readonly lastSyncedSha?: string | null;
    };
    if (syncState.lastSyncedSha && gitRefExists(rootDir, syncState.lastSyncedSha)) {
      return syncState.lastSyncedSha;
    }
    if (
      syncState.lastSyncedTag &&
      gitRefExists(rootDir, `refs/tags/upstream/${syncState.lastSyncedTag}`)
    ) {
      return `refs/tags/upstream/${syncState.lastSyncedTag}`;
    }
    if (syncState.lastSyncedTag && gitRefExists(rootDir, syncState.lastSyncedTag)) {
      return syncState.lastSyncedTag;
    }
  }
  if (gitRefExists(rootDir, "upstream/main")) {
    return "upstream/main";
  }
  return "HEAD";
}

function parseArgs(argv: ReadonlyArray<string>): {
  readonly baseRef?: string;
  readonly includeUntracked: boolean;
} {
  let baseRef: string | undefined;
  let includeUntracked = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" && argv[index + 1]) {
      baseRef = argv[index + 1];
      index += 1;
    } else if (arg === "--committed-only") {
      includeUntracked = false;
    }
  }
  return { ...(baseRef !== undefined ? { baseRef } : {}), includeUntracked };
}

function main() {
  const rootDir = NodePath.resolve(import.meta.dirname, "..");
  const args = parseArgs(process.argv.slice(2));
  const baseRef = args.baseRef ?? resolveDefaultBaseRef(rootDir);

  const numstatOutput = args.includeUntracked
    ? runGit(rootDir, ["diff", "--numstat", baseRef])
    : runGit(rootDir, ["diff", "--numstat", `${baseRef}...HEAD`]);
  const stats = [...parseGitNumstat(numstatOutput)];

  if (args.includeUntracked) {
    const untracked = runGit(rootDir, ["ls-files", "--others", "--exclude-standard"])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const filePath of untracked) {
      stats.push({ path: filePath, added: 1, deleted: 0 });
    }
  }

  const report = evaluateUpstreamFootprint(stats);
  console.log(
    `Upstream footprint check against ${baseRef}: ${report.botOwnedFiles.length} bot-owned files, ${report.glueFiles.length} thin-glue upstream files.`,
  );
  for (const glue of report.glueFiles) {
    const budget = ALLOWED_UPSTREAM_GLUE_BUDGETS[glue.path];
    const budgetLabel =
      budget === null ? "generated" : `${glue.added + glue.deleted}/${budget} lines`;
    console.log(`  glue: ${glue.path} (${budgetLabel})`);
  }

  if (!report.ok) {
    console.error("\nUpstream footprint violations detected:");
    for (const violation of report.violations) {
      console.error(`  [${violation.reason}] ${violation.path}: ${violation.detail}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main();
}
