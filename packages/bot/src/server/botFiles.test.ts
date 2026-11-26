import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BotFileListResponseSchema, BotFileResponseSchema } from "../contracts.ts";
import { runBotFileCommand } from "./botFiles.ts";
import { createBotInStateDir } from "./registry.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const decodeFile = Schema.decodeUnknownSync(BotFileResponseSchema);
const decodeList = Schema.decodeUnknownSync(BotFileListResponseSchema);

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const stateDir = yield* fs.makeTempDirectoryScoped();
  const bot = yield* createBotInStateDir(stateDir, { name: "Writer", summary: "Writes." });
  return { stateDir, bot };
});

describe("bot file commands", () => {
  it.effect("reads and saves persona, lessons, and long-term memory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir, bot } = yield* setup;

      for (const file of ["SOUL.md", "LESSONS.md", "memory/long-term.md"]) {
        const { file: loaded } = decodeFile(
          yield* runBotFileCommand(stateDir, "read", { botId: bot.id, path: file }),
        );
        expect(loaded.version).not.toBeNull();
        const { file: saved } = decodeFile(
          yield* runBotFileCommand(stateDir, "save", {
            botId: bot.id,
            path: file,
            content: `# ${file}\n新内容\n`,
            expectedVersion: loaded.version,
          }),
        );
        expect(saved.version).not.toBe(loaded.version);
        expect(yield* fs.readFileString(path.join(bot.path, file))).toBe(`# ${file}\n新内容\n`);
      }
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("lists daily notes newest first and creates a missing note", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir, bot } = yield* setup;
      const dailyDir = path.join(bot.path, "memory", "daily");
      yield* fs.writeFileString(path.join(dailyDir, "2026-11-01.md"), "a");
      yield* fs.writeFileString(path.join(dailyDir, "2026-11-20.md"), "b");
      yield* fs.writeFileString(path.join(dailyDir, "notes.txt"), "ignored");

      expect(decodeList(yield* runBotFileCommand(stateDir, "list", { botId: bot.id }))).toEqual({
        daily: ["memory/daily/2026-11-20.md", "memory/daily/2026-11-01.md"],
      });

      const missing = "memory/daily/2026-11-26.md";
      const { file } = decodeFile(
        yield* runBotFileCommand(stateDir, "read", { botId: bot.id, path: missing }),
      );
      expect(file).toEqual({ path: missing, content: "", version: null });
      yield* runBotFileCommand(stateDir, "save", {
        botId: bot.id,
        path: missing,
        content: "today",
        expectedVersion: null,
      });
      expect(yield* fs.readFileString(path.join(bot.path, missing))).toBe("today");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("refuses a save when the bot changed the file after it was loaded", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir, bot } = yield* setup;
      const { file } = decodeFile(
        yield* runBotFileCommand(stateDir, "read", { botId: bot.id, path: "memory/long-term.md" }),
      );
      const target = path.join(bot.path, "memory", "long-term.md");
      yield* fs.writeFileString(target, "written by the bot");

      const error = yield* runBotFileCommand(stateDir, "save", {
        botId: bot.id,
        path: "memory/long-term.md",
        content: "from the editor",
        expectedVersion: file.version,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("BotFileConflictError");
      expect(yield* fs.readFileString(target)).toBe("written by the bot");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("rejects paths outside the editable files and unknown bots", () =>
    Effect.gen(function* () {
      const { stateDir, bot } = yield* setup;
      for (const bad of ["bot.yaml", "POLICY.md", "../other/SOUL.md", "memory/daily/../../x.md"]) {
        const error = yield* runBotFileCommand(stateDir, "read", {
          botId: bot.id,
          path: bad,
        }).pipe(Effect.flip);
        expect(error._tag).toBe("BotFileValidationError");
      }
      const missing = yield* runBotFileCommand(stateDir, "read", {
        botId: "nope",
        path: "SOUL.md",
      }).pipe(Effect.flip);
      expect(missing._tag).toBe("BotNotFoundError");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
