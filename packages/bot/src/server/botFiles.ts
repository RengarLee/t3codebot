// @effect-diagnostics nodeBuiltinImport:off -- File versions are content hashes from node:crypto.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  BOT_DAILY_MEMORY_DIR,
  BOT_FILE_COMMANDS,
  BotFileListRequestSchema,
  BotFileReadRequestSchema,
  BotFileSaveRequestSchema,
  type BotFile,
  type BotFilePath,
  type BotFileSaveRequest,
} from "../contracts.ts";
import { BotNotFoundError } from "./home.ts";
import { BotCreateIoError, listStateDirBots } from "./registry.ts";

const BOT_FILE_MAX_BYTES = 256 * 1024;
const DAILY_NOTE_NAME = /^\d{4}-\d{2}-\d{2}\.md$/;

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

const readFile = Effect.fn("bot.files.read")(function* (
  stateDir: string,
  botId: string,
  filePath: BotFilePath,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(yield* botFolder(stateDir, botId), filePath);
  if (!(yield* fs.exists(target).pipe(asIoError))) {
    return { path: filePath, content: "", version: null } satisfies BotFile;
  }
  const content = yield* fs.readFileString(target).pipe(asIoError);
  return { path: filePath, content, version: fileVersion(content) } satisfies BotFile;
});

const listDailyNotes = Effect.fn("bot.files.listDaily")(function* (
  stateDir: string,
  botId: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(yield* botFolder(stateDir, botId), BOT_DAILY_MEMORY_DIR);
  const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const daily = entries
    .filter((entry) => DAILY_NOTE_NAME.test(entry))
    .toSorted()
    .toReversed()
    .map((entry): BotFilePath => `${BOT_DAILY_MEMORY_DIR}/${entry}`);
  return { daily };
});

/** Writes only when the file still matches what the editor loaded, so a bot's own write is never lost. */
const saveFile = Effect.fn("bot.files.save")(function* (
  stateDir: string,
  request: BotFileSaveRequest,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (Buffer.byteLength(request.content, "utf8") > BOT_FILE_MAX_BYTES) {
    return yield* new BotFileValidationError({
      detail: `${request.path} must be at most ${BOT_FILE_MAX_BYTES / 1024} KB.`,
    });
  }
  const current = yield* readFile(stateDir, request.botId, request.path);
  if (current.version !== request.expectedVersion) {
    return yield* new BotFileConflictError({ path: request.path });
  }
  const target = path.join(yield* botFolder(stateDir, request.botId), request.path);
  yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(asIoError);
  yield* fs.writeFileString(target, request.content).pipe(asIoError);
  return {
    path: request.path,
    content: request.content,
    version: fileVersion(request.content),
  } satisfies BotFile;
});

const decodeListRequest = Schema.decodeUnknownEffect(BotFileListRequestSchema);
const decodeReadRequest = Schema.decodeUnknownEffect(BotFileReadRequestSchema);
const decodeSaveRequest = Schema.decodeUnknownEffect(BotFileSaveRequestSchema);

/** Callers serialize these commands; read-check-write in `save` assumes no other request interleaves. */
export const runBotFileCommand = Effect.fn("bot.files.command")(function* (
  stateDir: string,
  command: string,
  body: unknown,
) {
  switch (command) {
    case BOT_FILE_COMMANDS.list:
      return yield* decodeListRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => listDailyNotes(stateDir, request.botId)),
      );
    case BOT_FILE_COMMANDS.read:
      return yield* decodeReadRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => readFile(stateDir, request.botId, request.path)),
        Effect.map((file) => ({ file })),
      );
    case BOT_FILE_COMMANDS.save:
      return yield* decodeSaveRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => saveFile(stateDir, request)),
        Effect.map((file) => ({ file })),
      );
    default:
      return yield* new BotFileValidationError({ detail: `Unknown file command: ${command}` });
  }
});
