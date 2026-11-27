// @effect-diagnostics nodeBuiltinImport:off -- Migration revisions use content hashes.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type { BotStoreShape } from "./db.ts";
const Journal = Schema.fromJsonString(
  Schema.Struct({ before: Schema.String, after: Schema.String }),
);
const encodeJournal = Schema.encodeEffect(Journal);
const decodeJournal = Schema.decodeEffect(Journal);
export const migrateLegacyMemory = Effect.fn("bot.memory.migrateLegacy")(function* (
  folder: string,
  botId: string,
  store: BotStoreShape,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
  const archive = path.join(folder, "memory", "legacy");
  const done = path.join(archive, "complete");
  if (yield* fs.exists(done)) return;
  yield* fs.makeDirectory(archive, { recursive: true });
  const journalPath = path.join(archive, "migration.json");
  const target = path.join(folder, "MEMORY.md");
  if (!(yield* fs.exists(journalPath))) {
    const days = yield* fs.readDirectory(path.join(folder, "memory", "daily")).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed(Array<string>()),
      ),
    );
    const files = [
      "LESSONS.md",
      "memory/long-term.md",
      ...days
        .filter((s) => s.endsWith(".md"))
        .sort()
        .map((s) => `memory/daily/${s}`),
    ];
    const before = yield* read(target);
    let after = before;
    for (const file of files) {
      const content = yield* read(path.join(folder, file));
      const saved = path.join(archive, file);
      yield* fs.makeDirectory(path.dirname(saved), { recursive: true });
      yield* fs.writeFileString(saved, content);
      if (
        /(?:PRIVATE KEY|\bsk-|\bghp_|github_pat_|xox[baprs]-|Bearer\s|password|passwd|token|api[_ -]?key|secret|密码|口令|验证码)/i.test(
          content,
        )
      )
        continue;
      for (const line of content.split(/\r?\n/).filter((s) => s.trim())) {
        const fact = line.trim().replace(/^[-*]\s+/, "");
        if (fact.length > 400 || after.split(/\r?\n/).includes(`- ${fact}`)) continue;
        const next = `${after}${after.endsWith("\n") || !after ? "" : "\n"}- ${fact}\n`;
        if (Buffer.byteLength(next, "utf8") <= 4096) after = next;
      }
    }
    yield* fs.writeFileString(`${journalPath}.tmp`, yield* encodeJournal({ before, after }));
    yield* fs.rename(`${journalPath}.tmp`, journalPath);
  }
  const journal = yield* decodeJournal(yield* read(journalPath));
  const current = yield* read(target);
  const content = current === journal.before ? journal.after : current;
  if (content !== current) {
    yield* fs.writeFileString(`${target}.migration`, content);
    yield* fs.rename(`${target}.migration`, target);
  }
  const scopeKey = `bot:${botId}`;
  const latest = yield* store.latestMemoryRevision(scopeKey);
  const contentHash = NodeCrypto.createHash("sha256").update(content).digest("hex");
  if (latest?.contentHash !== contentHash)
    yield* store.insertMemoryRevision({
      scopeKey,
      revision: (latest?.revision ?? 0) + 1,
      content,
      contentHash,
      trigger: "migration",
      reason: "legacy_memory",
      threadId: null,
    });
  yield* fs.writeFileString(done, "1\n");
});
