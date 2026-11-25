import { describe, expect, it } from "vite-plus/test";

import {
  evaluateUpstreamFootprint,
  isBotOwnedPath,
  parseGitNumstat,
} from "./bot-check-footprint.ts";

describe("bot-check-footprint", () => {
  it("recognizes bot-owned paths", () => {
    expect(isBotOwnedPath("packages/bot/src/server/http.ts")).toBe(true);
    expect(isBotOwnedPath("packages/bot/AGENTS.md")).toBe(true);
    expect(isBotOwnedPath(".agents/rules/bot-architecture.md")).toBe(true);
    expect(isBotOwnedPath(".claude/rules/bot-architecture.md")).toBe(true);
    expect(isBotOwnedPath(".github/workflows/bot-upstream-sync.yml")).toBe(true);
    expect(isBotOwnedPath("scripts/bot-upstream-sync.ts")).toBe(true);
    expect(isBotOwnedPath("scripts/scenarios/bot-integration.e2e.ts")).toBe(true);
    expect(isBotOwnedPath("apps/web/src/components/Sidebar.tsx")).toBe(false);
  });

  it("passes when only bot-owned files and within-budget glue hooks change", () => {
    const stats = parseGitNumstat(
      [
        "40\t0\tpackages/bot/src/contracts.ts",
        "2\t0\tapps/server/src/server.ts",
        "2\t0\tapps/web/src/components/Sidebar.tsx",
        "1\t1\tpackages/shared/src/cliRelease.ts",
        "120\t45\tpnpm-lock.yaml",
        "25\t2\tapps/web/src/routeTree.gen.ts",
      ].join("\n"),
    );

    const report = evaluateUpstreamFootprint(stats);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.botOwnedFiles).toEqual(["packages/bot/src/contracts.ts"]);
    expect(report.glueFiles.map((file) => file.path)).toEqual([
      "apps/server/src/server.ts",
      "apps/web/src/components/Sidebar.tsx",
      "packages/shared/src/cliRelease.ts",
      "pnpm-lock.yaml",
      "apps/web/src/routeTree.gen.ts",
    ]);
  });

  it("rejects banned conflict hotspots, unlisted upstream files, and over-budget glue edits", () => {
    const report = evaluateUpstreamFootprint([
      { path: "apps/web/src/i18n/translations/en.json", added: 2, deleted: 0 },
      { path: "packages/contracts/src/settings.ts", added: 2, deleted: 0 },
      { path: ".github/workflows/release.yml", added: 1, deleted: 1 },
      { path: "apps/server/src/ws.ts", added: 5, deleted: 0 },
      { path: "apps/web/src/components/Sidebar.tsx", added: 25, deleted: 3 },
    ]);

    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => [v.path, v.reason])).toEqual([
      ["apps/web/src/i18n/translations/en.json", "banned"],
      ["packages/contracts/src/settings.ts", "banned"],
      [".github/workflows/release.yml", "banned"],
      ["apps/server/src/ws.ts", "unlisted"],
      ["apps/web/src/components/Sidebar.tsx", "budget_exceeded"],
    ]);
  });

  it("accepts fork workflow guidance and Bot sender integration within their budgets", () => {
    const report = evaluateUpstreamFootprint([
      { path: "AGENTS.md", added: 4, deleted: 0 },
      { path: "evals/mcp-tool-use/README.md", added: 4, deleted: 0 },
      { path: "evals/mcp-tool-use/run.ts", added: 2, deleted: 0 },
      { path: "evals/mcp-tool-use/botSessionCases.ts", added: 75, deleted: 0 },
      { path: "packages/contracts/src/orchestrationV2.ts", added: 5, deleted: 3 },
      { path: "packages/contracts/src/orchestrationV2.test.ts", added: 6, deleted: 1 },
    ]);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.botOwnedFiles).toEqual(["evals/mcp-tool-use/botSessionCases.ts"]);
  });

  it("still rejects larger shared-file edits and unrelated eval changes", () => {
    const report = evaluateUpstreamFootprint([
      { path: "AGENTS.md", added: 5, deleted: 0 },
      { path: "evals/mcp-tool-use/README.md", added: 5, deleted: 0 },
      { path: "evals/mcp-tool-use/run.ts", added: 3, deleted: 0 },
      { path: "packages/contracts/src/orchestrationV2.ts", added: 7, deleted: 3 },
      { path: "packages/contracts/src/orchestrationV2.test.ts", added: 7, deleted: 1 },
      { path: "evals/mcp-tool-use/otherCases.ts", added: 1, deleted: 0 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.reason)).toEqual([
      "budget_exceeded",
      "budget_exceeded",
      "budget_exceeded",
      "budget_exceeded",
      "budget_exceeded",
      "unlisted",
    ]);
  });
});
