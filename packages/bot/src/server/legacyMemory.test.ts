import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { openBotStore } from "./db.ts";
import { migrateLegacyMemory } from "./legacyMemory.ts";
import { applyMemoryOperations } from "./memoryOperations.ts";
import { readStandingNotes } from "./standingNotes.ts";
const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
describe("legacy memory", () => {
  it.effect(
    "archives overflow, preserves existing notes, recovers interrupted completion and never reimports deletions",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(folder, "bots.sqlite"));
        yield* fs.makeDirectory(path.join(folder, "memory", "daily"), { recursive: true });
        const target = path.join(folder, "MEMORY.md");
        yield* fs.writeFileString(target, "user content\n");
        yield* fs.writeFileString(path.join(folder, "LESSONS.md"), "old lesson\n");
        const long = "中文".repeat(3000);
        yield* fs.writeFileString(path.join(folder, "memory", "long-term.md"), long);
        yield* fs.writeFileString(path.join(folder, "memory", "daily", "one.md"), "daily fact\n");
        const done = path.join(folder, "memory", "legacy", "complete");
        const interrupted = yield* migrateLegacyMemory(folder, "test", {
          ...store,
          insertMemoryRevision: () => Effect.die("interrupted"),
        }).pipe(Effect.exit);
        expect(interrupted._tag).toBe("Failure");
        yield* migrateLegacyMemory(folder, "test", store);
        const merged = yield* fs.readFileString(target);
        expect(merged).toContain("user content");
        expect(merged).toContain("old lesson");
        expect(merged).toContain("daily fact");
        expect(
          applyMemoryOperations(merged, [
            { op: "remove", scope: "bot", old: "old lesson", text: "" },
          ]),
        ).not.toContain("old lesson");
        expect(Buffer.byteLength(merged)).toBeLessThanOrEqual(4096);
        expect(
          yield* fs.readFileString(path.join(folder, "memory", "legacy", "memory", "long-term.md")),
        ).toBe(long);
        yield* fs.remove(done);
        yield* migrateLegacyMemory(folder, "test", store);
        expect(yield* fs.readFileString(target)).toBe(merged);
        expect(yield* store.listMemoryRevisions("bot:test", 50)).toHaveLength(1);
        yield* fs.writeFileString(target, "user removed facts\n");
        yield* migrateLegacyMemory(folder, "test", store);
        expect(yield* fs.readFileString(target)).toBe("user removed facts\n");
        const oversized = "- 用户偏好中文。\n".repeat(1000);
        yield* fs.writeFileString(target, oversized);
        expect(
          Buffer.byteLength((yield* readStandingNotes(folder)).memory, "utf8"),
        ).toBeLessThanOrEqual(4096);
        expect(yield* fs.readFileString(target)).toBe(oversized);
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
