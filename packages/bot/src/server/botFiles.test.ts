import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BotFileResponseSchema } from "../contracts.ts";
import { makeBotFileService, runBotFileCommand } from "./botFiles.ts";
import { openBotStore } from "./db.ts";
import { createBotInStateDir } from "./registry.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const decodeFile = Schema.decodeUnknownSync(BotFileResponseSchema);

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

      for (const file of ["SOUL.md", "POLICY.md", "MEMORY.md"]) {
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

  it.effect("refuses a save when the bot changed the file after it was loaded", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir, bot } = yield* setup;
      const { file } = decodeFile(
        yield* runBotFileCommand(stateDir, "read", { botId: bot.id, path: "MEMORY.md" }),
      );
      const target = path.join(bot.path, "MEMORY.md");
      yield* fs.writeFileString(target, "written by the bot");

      const error = yield* runBotFileCommand(stateDir, "save", {
        botId: bot.id,
        path: "MEMORY.md",
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
      for (const bad of ["bot.yaml", "LESSONS.md", "../other/SOUL.md", "memory/daily/../../x.md"]) {
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

it.effect("serializes manual saves, review, shared memory and restore with real history", () =>
  Effect.gen(function* () {
    const { stateDir, bot } = yield* setup;
    const path = yield* Path.Path;
    const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
    const service = yield* makeBotFileService(stateDir, store);
    const initial = yield* service.read(bot.id, "MEMORY.md");
    const request = {
      botId: bot.id,
      path: "MEMORY.md",
      expectedVersion: initial.version,
      content: "- manual\n",
    };
    const results = yield* Effect.all(
      [
        service.command("save", request).pipe(Effect.result),
        service.command("save", { ...request, content: "- second\n" }).pipe(Effect.result),
      ],
      { concurrency: "unbounded" },
    );
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
    const saved = yield* service.read(bot.id, "MEMORY.md");
    const conflict = yield* service
      .applyOperations(
        bot.id,
        "bot",
        initial.version,
        [{ scope: "bot", op: "add", old: "", text: "late" }],
        "review",
        "thread",
      )
      .pipe(Effect.flip);
    expect(conflict._tag).toBe("BotFileConflictError");
    expect((yield* service.read(bot.id, "MEMORY.md")).content).toBe(saved.content);
    const history = yield* store.listMemoryRevisions(`bot:${bot.id}`, 50);
    expect(history).toHaveLength(2);
    yield* service.command("restore", {
      botId: bot.id,
      path: "MEMORY.md",
      revision: 1,
      expectedVersion: saved.version,
    });
    expect((yield* service.read(bot.id, "MEMORY.md")).content).toBe(initial.content);
    expect((yield* store.latestMemoryRevision(`bot:${bot.id}`))?.reason).toBe("restore");
    const other = yield* createBotInStateDir(stateDir, { name: "Other", summary: "Other" });
    const shared = yield* service.read(bot.id, "USER.md");
    yield* service.applyOperations(
      bot.id,
      "user",
      shared.version,
      [{ scope: "user", op: "add", old: "", text: "shared preference" }],
      "remember",
      "thread",
    );
    expect((yield* service.read(other.id, "USER.md")).content).toContain("shared preference");
    expect((yield* store.latestMemoryRevision("shared"))?.trigger).toBe("review");
  }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
);
