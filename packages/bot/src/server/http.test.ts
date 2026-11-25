import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  BOT_HEALTH_ROUTE,
  BOT_SESSION_RECEIPT_JSON_SCHEMA,
  BotHealthResponseSchema,
  MAIN_BOT_ID,
} from "../contracts.ts";
import { createBotHealthPayload } from "./http.ts";
import {
  createBotInStateDir,
  ensureMainBotInStateDir,
  listStateDirBots,
  parseBotYaml,
} from "./registry.ts";
import { resolveBotStoragePaths } from "./storage.ts";

const decodeHealthResponse = Schema.decodeSync(BotHealthResponseSchema);
const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("bot server module", () => {
  it("builds a schema-valid health payload on /api/bots/health", () => {
    expect(BOT_HEALTH_ROUTE).toBe("/api/bots/health");
    const payload = createBotHealthPayload(2);
    expect(decodeHealthResponse(payload)).toEqual({
      ok: true,
      module: "t3codebot",
      botsCount: 2,
    });
  });

  it("parses bot.yaml metadata fields cleanly", () => {
    const parsed = parseBotYaml(
      [
        "# comment",
        'id: "11111111-2222-4333-8444-555555555555"',
        'name: "个人总管"',
        'version: "0.2.0"',
        'status: "active" # draft | active',
        'summary: "日程统筹与待办跟踪"',
        'in_scope: ["日程", "待办"]',
        "out_of_scope: not-a-list",
        'projects: ["/tmp/repo"]',
        'working_folders: ["/tmp/notes", "/tmp/docs"]',
        "runtime:",
        '  session_mode: "fresh_per_run"',
      ].join("\n"),
    );
    expect(parsed).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      name: "个人总管",
      version: "0.2.0",
      status: "active",
      summary: "日程统筹与待办跟踪",
      inScope: ["日程", "待办"],
      projects: ["/tmp/repo"],
      workingFolders: ["/tmp/notes", "/tmp/docs"],
      sessionMode: "fresh_per_run",
    });
  });

  it.effect("isolates bot persistence paths outside upstream statev2.sqlite", () =>
    Effect.gen(function* () {
      const paths = yield* resolveBotStoragePaths("/tmp/t3-state");
      const sep = (yield* Path.Path).sep;
      expect(paths.directory).toBe(["", "tmp", "t3-state", "bots"].join(sep));
      expect(paths.sqlitePath).toContain("bots.sqlite");
      expect(paths.sqlitePath).not.toContain("statev2.sqlite");
      expect(paths.configPath).toContain("bots-config.json");
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("discovers bots under <stateDir>/bots while skipping internal directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const botsDir = path.join(stateDir, "bots");

      yield* fs.makeDirectory(path.join(botsDir, "_shared"), { recursive: true });
      yield* fs.makeDirectory(path.join(botsDir, "_template"), { recursive: true });
      yield* fs.makeDirectory(path.join(botsDir, ".local"), { recursive: true });

      const botId = "11111111-2222-4333-8444-555555555555";
      const botDir = path.join(botsDir, botId);
      yield* fs.makeDirectory(path.join(botDir, "skills", "daily-briefing"), { recursive: true });
      yield* fs.writeFileString(
        path.join(botDir, "bot.yaml"),
        [
          `id: "${botId}"`,
          'name: "个人总管"',
          'version: "0.1.0"',
          'status: "active"',
          'summary: "统筹日程与任务"',
          "runtime:",
          '  session_mode: "fresh_per_run"',
          "",
        ].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(botDir, "skills", "daily-briefing", "SKILL.md"),
        "# Daily Briefing\n",
      );

      const result = yield* listStateDirBots(stateDir);
      expect(result.directory).toBe(botsDir);
      expect(result.bots).toHaveLength(1);
      expect(result.bots[0]).toMatchObject({
        id: botId,
        name: "个人总管",
        status: "active",
        summary: "统筹日程与任务",
        skillsCount: 1,
      });
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("creates a new bot under <stateDir>/bots and rejects duplicate names", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped();

      const created = yield* createBotInStateDir(stateDir, {
        name: "代码评审助手",
        summary: "盯 PR 和测试回归",
      });
      expect(created.name).toBe("代码评审助手");
      expect(created.summary).toBe("盯 PR 和测试回归");
      expect(created.status).toBe("active");
      for (const file of ["SOUL.md", "POLICY.md", "LESSONS.md", "memory/long-term.md"]) {
        expect(yield* fs.exists(`${created.path}/${file}`)).toBe(true);
      }

      const duplicate = yield* Effect.exit(createBotInStateDir(stateDir, { name: "代码评审助手" }));
      expect(Exit.isFailure(duplicate)).toBe(true);

      const listed = yield* listStateDirBots(stateDir);
      expect(listed.bots).toHaveLength(1);
      expect(listed.bots[0]?.id).toBe(created.id);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("keeps exactly one main bot and lists every other bot as a sub-bot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const sub = yield* createBotInStateDir(stateDir, {
        name: "Bot",
        summary: "Researches upstream T3 changes.",
        inScope: ["external research"],
      });

      const main = yield* ensureMainBotInStateDir(stateDir);
      expect(main).toMatchObject({ id: MAIN_BOT_ID, role: "main" });
      expect(main.path).toBe(path.join(stateDir, "bots", MAIN_BOT_ID));

      const instructionsPath = path.join(main.path, "workspace", "AGENTS.md");
      expect(yield* fs.readFileString(instructionsPath)).toContain(
        JSON.stringify(BOT_SESSION_RECEIPT_JSON_SCHEMA),
      );
      expect(yield* fs.readFileString(path.join(main.path, "workspace", "CLAUDE.md"))).toBe(
        "@AGENTS.md\n",
      );
      expect(yield* fs.readFileString(instructionsPath)).toContain("No sub-bots yet.");

      // Bot routes only to active sub-bots that already have their own project.
      const again = yield* ensureMainBotInStateDir(
        stateDir,
        new Map([[sub.id, { projectId: "sub-project", homeThreadId: null }]]),
      );
      expect(again.path).toBe(main.path);
      expect(yield* fs.readFileString(instructionsPath)).toContain(
        "| Bot: Researches upstream T3 changes. | sub-project | external research |  |",
      );

      const listed = yield* listStateDirBots(stateDir);
      expect(listed.bots.map((bot) => [bot.id, bot.role])).toEqual(
        [
          [MAIN_BOT_ID, "main"],
          [sub.id, "sub"],
        ].sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
