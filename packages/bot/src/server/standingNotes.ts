import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { BOT_MEMORY_MAX_BYTES } from "../contracts.ts";

function boundedMemory(content: string): string {
  if (Buffer.byteLength(content, "utf8") <= BOT_MEMORY_MAX_BYTES) return content;
  let result = "";
  for (const line of content.split("\n")) {
    const next = `${result}${line}\n`;
    if (Buffer.byteLength(next, "utf8") > BOT_MEMORY_MAX_BYTES) break;
    result = next;
  }
  return result;
}

export const readStandingNotes = Effect.fn("bot.memory.readStandingNotes")(function* (
  folder: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (target: string) =>
    fs.readFileString(target).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
  return {
    soul: yield* read(path.join(folder, "SOUL.md")),
    policy: yield* read(path.join(folder, "POLICY.md")),
    memory: boundedMemory(yield* read(path.join(folder, "MEMORY.md"))),
    user: boundedMemory(
      yield* read(path.join(path.dirname(folder), "_shared", "memory", "USER.md")),
    ),
  };
});
