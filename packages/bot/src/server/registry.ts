// @effect-diagnostics nodeBuiltinImport:off -- Uses node:crypto for UUID v4 generation.
import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { MAIN_BOT_ID, type BotListResponse, type BotSummary } from "../contracts.ts";
import type { BotHome } from "./db.ts";
import { resolveBotStoragePaths } from "./storage.ts";
import { renderBotFiles, renderMainBotInstructions, renderSessionLog } from "./template.ts";

export class BotCreateValidationError extends Schema.TaggedError<
  BotCreateValidationError,
  { readonly brand: unique symbol }
>()("BotCreateValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export class BotCreateIoError extends Schema.TaggedError<
  BotCreateIoError,
  { readonly brand: unique symbol }
>()("BotCreateIoError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export type BotCreateFailure = BotCreateValidationError | BotCreateIoError;

export interface BotCreateInput {
  readonly name: string;
  readonly summary?: string | undefined;
  /** Fixed directory and id; a random UUID otherwise. */
  readonly id?: string | undefined;
  readonly inScope?: ReadonlyArray<string> | undefined;
  readonly outOfScope?: ReadonlyArray<string> | undefined;
  readonly persona?: string | undefined;
  readonly projects?: ReadonlyArray<string> | undefined;
  readonly workingFolders?: ReadonlyArray<string> | undefined;
}

export interface ParsedBotYaml {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly version?: string;
  readonly sessionMode?: string;
  readonly inScope?: ReadonlyArray<string>;
  readonly outOfScope?: ReadonlyArray<string>;
  readonly projects?: ReadonlyArray<string>;
  readonly workingFolders?: ReadonlyArray<string>;
}

const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const encodeStringList = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeStringList = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const match = /^"((?:\\.|[^"\\])*)"/.exec(trimmed);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed === "string") return parsed;
      } catch {
        return match[1] ?? "";
      }
    }
  }
  if (trimmed.startsWith("'")) {
    const match = /^'((?:''|[^'])*)'/.exec(trimmed);
    if (match) {
      return (match[1] ?? "").replaceAll("''", "'");
    }
  }
  const commentIndex = trimmed.indexOf(" #");
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

export function parseBotYaml(source: string): ParsedBotYaml {
  const result: {
    id?: string;
    name?: string;
    status?: string;
    summary?: string;
    version?: string;
    sessionMode?: string;
    inScope?: ReadonlyArray<string>;
    outOfScope?: ReadonlyArray<string>;
    projects?: ReadonlyArray<string>;
    workingFolders?: ReadonlyArray<string>;
  } = {};
  let inRuntime = false;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent === 0) {
      inRuntime = trimmed === "runtime:";
      const match = /^([a-zA-Z0-9_]+)\s*:\s*(.*)$/.exec(trimmed);
      if (!match) continue;
      const key = match[1];
      if (
        key === "in_scope" ||
        key === "out_of_scope" ||
        key === "projects" ||
        key === "working_folders"
      ) {
        const list = decodeStringList((match[2] ?? "").trim());
        if (list._tag === "Some") {
          if (key === "in_scope") result.inScope = list.value;
          else if (key === "out_of_scope") result.outOfScope = list.value;
          else if (key === "projects") result.projects = list.value;
          else result.workingFolders = list.value;
        }
        continue;
      }
      const value = unquoteYamlScalar(match[2] ?? "");
      if (!value) continue;
      if (key === "id") result.id = value;
      else if (key === "name") result.name = value;
      else if (key === "status") result.status = value;
      else if (key === "summary") result.summary = value;
      else if (key === "version") result.version = value;
    } else if (inRuntime) {
      const match = /^session_mode\s*:\s*(.*)$/.exec(trimmed);
      if (match) {
        const value = unquoteYamlScalar(match[1] ?? "");
        if (value) result.sessionMode = value;
      }
    }
  }

  return result;
}

function upsertYamlFieldLine(source: string, key: string, encodedValue: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const nextLine = `${key}: ${encodedValue}`;
  const lines = source.split(/\r?\n/);
  const existingIndex = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = nextLine;
    return lines.join(newline);
  }
  const runtimeIndex = lines.findIndex((line) => /^runtime\s*:/.test(line));
  if (runtimeIndex >= 0) {
    lines.splice(runtimeIndex, 0, nextLine);
    return lines.join(newline);
  }
  if (lines.at(-1) === "") {
    lines.splice(lines.length - 1, 0, nextLine);
    return lines.join(newline);
  }
  return [...lines, nextLine, ""].join(newline);
}

/** Replaces or inserts a top-level JSON-encoded string key in `bot.yaml` without clobbering other lines. */
export function upsertYamlStringField(source: string, key: string, value: string): string {
  return upsertYamlFieldLine(source, key, encodeString(value));
}

/** Replaces or inserts a top-level JSON-encoded string-list key in `bot.yaml` without clobbering other lines. */
export function upsertYamlStringListField(
  source: string,
  key: string,
  values: ReadonlyArray<string>,
): string {
  return upsertYamlFieldLine(source, key, encodeStringList(values));
}

const isDirectory = Effect.fn("bot.isDirectory")(function* (targetPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(targetPath).pipe(Effect.option);
  return stat._tag === "Some" && stat.value.type === "Directory";
});

const isFile = Effect.fn("bot.isFile")(function* (targetPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(targetPath).pipe(Effect.option);
  return stat._tag === "Some" && stat.value.type === "File";
});

const countBotLocalSkills = Effect.fn("bot.countLocalSkills")(function* (botDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillsDir = path.join(botDir, "skills");
  if (!(yield* isDirectory(skillsDir))) return 0;
  const entries = yield* fs.readDirectory(skillsDir).pipe(Effect.orElseSucceed(() => []));
  let count = 0;
  for (const entry of entries) {
    if (entry.startsWith(".") || entry.startsWith("_")) continue;
    const skillFile = path.join(skillsDir, entry, "SKILL.md");
    if (yield* isFile(skillFile)) count += 1;
  }
  return count;
});

/**
 * Scans `<stateDir>/bots` for bot directories (`<bot-id>/bot.yaml`),
 * ignoring internal `_`-prefixed and `.`-prefixed directories (`_shared`, `_template`, `_scripts`, `.local`).
 */
export const listBotsInDirectory = Effect.fn("bot.listBotsInDirectory")(function* (
  botsDir: string,
  homesByBot?: ReadonlyMap<string, BotHome>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* isDirectory(botsDir))) {
    return [] as ReadonlyArray<BotSummary>;
  }
  const entries = yield* fs.readDirectory(botsDir).pipe(Effect.orElseSucceed(() => []));
  const bots: BotSummary[] = [];

  for (const entry of [...entries].sort()) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const botDir = path.join(botsDir, entry);
    if (!(yield* isDirectory(botDir))) continue;
    const yamlPath = path.join(botDir, "bot.yaml");
    if (!(yield* isFile(yamlPath))) continue;
    const yamlText = yield* fs.readFileString(yamlPath).pipe(Effect.orElseSucceed(() => ""));
    const parsed = parseBotYaml(yamlText);
    const id = parsed.id?.trim() || entry;
    const skillsCount = yield* countBotLocalSkills(botDir);
    bots.push({
      id,
      role: id === MAIN_BOT_ID ? "main" : "sub",
      name: parsed.name?.trim() || entry,
      status: parsed.status?.trim() || "draft",
      summary: parsed.summary?.trim() || "",
      inScope: parsed.inScope ?? [],
      outOfScope: parsed.outOfScope ?? [],
      workingFolders: parsed.workingFolders ?? [],
      version: parsed.version?.trim() || "0.1.0",
      sessionMode: parsed.sessionMode?.trim() || "fresh_per_run",
      skillsCount,
      path: botDir,
      projectId: homesByBot?.get(id)?.projectId ?? null,
      homeThreadId: homesByBot?.get(id)?.homeThreadId ?? null,
    });
  }

  return bots;
});

export const listStateDirBots = Effect.fn("bot.listStateDirBots")(function* (
  stateDir: string,
  homesByBot?: ReadonlyMap<string, BotHome>,
) {
  const paths = yield* resolveBotStoragePaths(stateDir);
  const bots = yield* listBotsInDirectory(paths.directory, homesByBot);
  return {
    directory: paths.directory,
    bots,
  } satisfies BotListResponse;
});

export const createBotInStateDir = Effect.fn("bot.createInStateDir")(function* (
  stateDir: string,
  input: BotCreateInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = input.name.trim();

  if (!name) {
    return yield* new BotCreateValidationError({ detail: "Bot name is required." });
  }

  const paths = yield* resolveBotStoragePaths(stateDir);
  const existing = yield* listBotsInDirectory(paths.directory);
  if (existing.some((bot) => bot.id === input.id)) {
    return yield* new BotCreateValidationError({ detail: `Bot '${input.id}' already exists.` });
  }
  if (
    input.id === undefined &&
    existing.some((bot) => bot.name.toLowerCase() === name.toLowerCase())
  ) {
    return yield* new BotCreateValidationError({
      detail: `A bot named "${name}" already exists.`,
    });
  }

  const botId = input.id ?? NodeCrypto.randomUUID().toLowerCase();
  const botDir = path.join(paths.directory, botId);
  const files = renderBotFiles({
    id: botId,
    name,
    summary: input.summary?.trim() ?? "",
    inScope: input.inScope ?? [],
    outOfScope: input.outOfScope ?? [],
    persona: input.persona ?? "",
    projects: input.projects ?? [],
    workingFolders: input.workingFolders ?? [],
    createdAt: DateTime.formatIso(yield* DateTime.now),
  });
  for (const [relativePath, content] of files) {
    const filePath = path.join(botDir, relativePath);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.flatMap(() => fs.writeFileString(filePath, content)),
      Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })),
    );
  }

  const reloaded = yield* listBotsInDirectory(paths.directory);
  const created = reloaded.find((bot) => bot.id === botId);
  if (!created) {
    return yield* new BotCreateIoError({
      detail: `Created bot '${botId}' could not be reloaded.`,
    });
  }
  return created;
});
/** Rewrites a bot-managed file only when its content changed. */
export const writeFileIfChanged = Effect.fn("bot.writeFileIfChanged")(function* (
  filePath: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const current = yield* fs.readFileString(filePath).pipe(Effect.option);
  if (current._tag === "Some" && current.value === content) return;
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
    Effect.flatMap(() => fs.writeFileString(filePath, content)),
    Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })),
  );
});

/** Sub-bots Bot may route to: active and already given their own T3 project. */
export function routableSubBots(bots: ReadonlyArray<BotSummary>): ReadonlyArray<BotSummary> {
  return bots.filter((bot) => bot.role === "sub" && bot.status === "active" && bot.projectId);
}

/**
 * The main bot is created on first use so the user always has one to open. Its `AGENTS.md` is
 * bot-managed and regenerated, so the roster stays in step with the sub-bots on disk.
 */
export const ensureMainBotInStateDir = Effect.fn("bot.ensureMainBot")(function* (
  stateDir: string,
  homesByBot?: ReadonlyMap<string, BotHome>,
) {
  const path = yield* Path.Path;
  const { bots } = yield* listStateDirBots(stateDir, homesByBot);
  const main =
    bots.find((bot) => bot.id === MAIN_BOT_ID) ??
    (yield* createBotInStateDir(stateDir, {
      id: MAIN_BOT_ID,
      name: "Bot",
      summary: "Takes every request, dispatches sessions, and reports back.",
    }));
  yield* writeFileIfChanged(
    path.join(main.path, "workspace", "AGENTS.md"),
    renderMainBotInstructions(routableSubBots(bots), main.workingFolders),
  );
  const sessionLog = path.join(main.path, "workspace", "SESSIONS.md");
  if (!(yield* isFile(sessionLog))) yield* writeFileIfChanged(sessionLog, renderSessionLog([]));
  return main;
});
