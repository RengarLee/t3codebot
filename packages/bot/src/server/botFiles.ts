// @effect-diagnostics nodeBuiltinImport:off -- File versions are content hashes from node:crypto.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { applyMemoryOperations } from "./memoryOperations.ts";

import {
  BOT_MEMORY_MAX_BYTES,
  BOT_FILE_COMMANDS,
  BotFileHistoryRequestSchema,
  BotFileRestoreRequestSchema,
  BotFileReadRequestSchema,
  BotFileSaveRequestSchema,
  type BotMemoryOp,
  type BotMemoryRevisionTrigger,
  type BotFile,
  type BotFilePath,
  type BotFileSaveRequest,
} from "../contracts.ts";
import type { BotStoreShape } from "./db.ts";
import { BotNotFoundError } from "./home.ts";
import { BotCreateIoError, listStateDirBots } from "./registry.ts";

const BOT_FILE_MAX_BYTES = 256 * 1024;

export class BotFileValidationError extends Schema.TaggedError<
  BotFileValidationError,
  { readonly brand: unique symbol }
>()("BotFileValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export class BotFileConflictError extends Schema.TaggedError<
  BotFileConflictError,
  { readonly brand: unique symbol }
>()("BotFileConflictError", {
  path: Schema.String,
}) {
  override get message(): string {
    return `${this.path} changed since you opened it.`;
  }
}

function fileVersion(content: string): string {
  return NodeCrypto.createHash("sha256").update(content).digest("hex");
}

const asBadBody = Effect.mapError(
  () => new BotFileValidationError({ detail: "The request body is not valid for this command." }),
);
const asIoError = Effect.mapError(
  (cause: unknown) => new BotCreateIoError({ detail: String(cause) }),
);

const botFolder = Effect.fn("bot.files.botFolder")(function* (stateDir: string, botId: string) {
  const { bots } = yield* listStateDirBots(stateDir);
  const bot = bots.find((candidate) => candidate.id === botId);
  if (bot === undefined) return yield* new BotNotFoundError({ botId });
  return bot.path;
});

const resolveFile = Effect.fn("bot.files.resolve")(function* (
  stateDir: string,
  botId: string,
  file: BotFilePath,
) {
  const path = yield* Path.Path;
  const folder = yield* botFolder(stateDir, botId);
  return file === "USER.md"
    ? path.join(path.dirname(folder), "_shared", "memory", file)
    : path.join(folder, file);
});

const readFile = Effect.fn("bot.files.read")(function* (
  stateDir: string,
  botId: string,
  filePath: BotFilePath,
) {
  const fs = yield* FileSystem.FileSystem;
  const target = yield* resolveFile(stateDir, botId, filePath);
  if (!(yield* fs.exists(target).pipe(asIoError))) {
    return { path: filePath, content: "", version: null } satisfies BotFile;
  }
  const content = yield* fs.readFileString(target).pipe(asIoError);
  return { path: filePath, content, version: fileVersion(content) } satisfies BotFile;
});

/** Writes only when the file still matches what the editor loaded, so a bot's own write is never lost. */
const saveFile = Effect.fn("bot.files.save")(function* (
  stateDir: string,
  request: BotFileSaveRequest,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (
    Buffer.byteLength(request.content, "utf8") >
    (request.path === "MEMORY.md" || request.path === "USER.md"
      ? BOT_MEMORY_MAX_BYTES
      : BOT_FILE_MAX_BYTES)
  ) {
    return yield* new BotFileValidationError({
      detail: `${request.path} must be at most ${(request.path === "MEMORY.md" || request.path === "USER.md" ? BOT_MEMORY_MAX_BYTES : BOT_FILE_MAX_BYTES) / 1024} KB.`,
    });
  }
  const current = yield* readFile(stateDir, request.botId, request.path);
  if (current.version !== request.expectedVersion) {
    return yield* new BotFileConflictError({ path: request.path });
  }
  const target = yield* resolveFile(stateDir, request.botId, request.path);
  yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(asIoError);
  yield* fs.writeFileString(target, request.content).pipe(asIoError);
  return {
    path: request.path,
    content: request.content,
    version: fileVersion(request.content),
  } satisfies BotFile;
});

const decodeReadRequest = Schema.decodeUnknownEffect(BotFileReadRequestSchema);
const decodeSaveRequest = Schema.decodeUnknownEffect(BotFileSaveRequestSchema);
const decodeHistoryRequest = Schema.decodeUnknownEffect(BotFileHistoryRequestSchema);
const decodeRestoreRequest = Schema.decodeUnknownEffect(BotFileRestoreRequestSchema);

export const makeBotFileService = Effect.fn("bot.files.make")(function* <E = never, R = never>(
  stateDir: string,
  store?: BotStoreShape,
  onChanged: Effect.Effect<void, E, R> = Effect.void,
) {
  const lock = yield* Semaphore.make(1);
  const memoryKey = (botId: string, file: string) =>
    file === "USER.md" ? "shared" : `bot:${botId}`;
  const record = Effect.fn("bot.files.record")(function* (
    botId: string,
    file: BotFile,
    trigger: BotMemoryRevisionTrigger,
    reason: string,
    threadId: string | null = null,
  ) {
    if (!store || (file.path !== "MEMORY.md" && file.path !== "USER.md")) return;
    const scopeKey = memoryKey(botId, file.path);
    const latest = yield* store.latestMemoryRevision(scopeKey);
    const contentHash = fileVersion(file.content);
    if (latest?.contentHash === contentHash && reason !== "restore") return;
    yield* store.insertMemoryRevision({
      scopeKey,
      revision: (latest?.revision ?? 0) + 1,
      content: file.content,
      contentHash,
      trigger,
      reason,
      threadId,
    });
  });
  const write = Effect.fn("bot.files.write")(function* (
    request: BotFileSaveRequest,
    trigger: BotMemoryRevisionTrigger,
    reason: string,
    threadId: string | null = null,
  ) {
    const current = yield* readFile(stateDir, request.botId, request.path);
    if (current.version !== request.expectedVersion)
      return yield* new BotFileConflictError({ path: request.path });
    yield* record(request.botId, current, "external", "external");
    const file = yield* saveFile(stateDir, request);
    yield* record(request.botId, file, trigger, reason, threadId);
    yield* onChanged;
    return file;
  });
  const read = (botId: string, path: BotFilePath) =>
    lock.withPermits(1)(readFile(stateDir, botId, path));
  const command = Effect.fn("bot.files.command")(function* (command: string, body: unknown) {
    switch (command) {
      case BOT_FILE_COMMANDS.read: {
        const request = yield* decodeReadRequest(body).pipe(asBadBody);
        return { file: yield* readFile(stateDir, request.botId, request.path) };
      }
      case BOT_FILE_COMMANDS.history: {
        const request = yield* decodeHistoryRequest(body).pipe(asBadBody);
        yield* record(
          request.botId,
          yield* readFile(stateDir, request.botId, request.path),
          "external",
          "external",
        );
        return {
          revisions: store
            ? yield* store.listMemoryRevisions(memoryKey(request.botId, request.path), 50)
            : [],
        };
      }
      case BOT_FILE_COMMANDS.save: {
        const request = yield* decodeSaveRequest(body).pipe(asBadBody);
        return { file: yield* write(request, "user_manual", "user_manual") };
      }
      case "restore": {
        const request = yield* decodeRestoreRequest(body).pipe(asBadBody);
        const revisions = store
          ? yield* store.listMemoryRevisions(memoryKey(request.botId, request.path), 50)
          : [];
        const revision = revisions.find((entry) => entry.revision === request.revision);
        if (!revision)
          return yield* new BotFileValidationError({
            detail: "Memory revision was not found in this scope.",
          });
        return {
          file: yield* write({ ...request, content: revision.content }, "user_manual", "restore"),
        };
      }
      default:
        return yield* new BotFileValidationError({ detail: `Unknown file command: ${command}` });
    }
  });
  const applyOperations = (
    botId: string,
    scope: "bot" | "user",
    expectedVersion: string | null,
    operations: ReadonlyArray<BotMemoryOp>,
    reason: string,
    threadId: string | null,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const path = scope === "user" ? "USER.md" : "MEMORY.md";
        if (operations.some((operation) => operation.scope !== scope))
          return yield* new BotFileValidationError({
            detail: "Memory operation scope does not match the target.",
          });
        const current = yield* readFile(stateDir, botId, path);
        if (current.version !== expectedVersion) return yield* new BotFileConflictError({ path });
        const content = yield* Effect.try({
          try: () => applyMemoryOperations(current.content, operations),
          catch: (cause) =>
            new BotFileValidationError({
              detail: cause instanceof Error ? cause.message : "Invalid memory operations.",
            }),
        });
        return yield* write({ botId, path, expectedVersion, content }, "review", reason, threadId);
      }),
    );
  return {
    read,
    command: (name: string, body: unknown) => lock.withPermits(1)(command(name, body)),
    applyOperations,
  };
});

export type BotFileService = Effect.Success<ReturnType<typeof makeBotFileService>>;

// Compatibility for sequential migration and command callers; live callers share one service.
export const runBotFileCommand = Effect.fn("bot.files.compatCommand")(function* (
  stateDir: string,
  command: string,
  body: unknown,
  store?: BotStoreShape,
) {
  const service = yield* makeBotFileService(stateDir, store);
  return yield* service.command(command, body);
});
