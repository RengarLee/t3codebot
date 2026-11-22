// @effect-diagnostics nodeBuiltinImport:off -- Uses node:crypto for UUID v4 generation.
import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { BotCreateInput, BotListResponse, BotSummary } from "../contracts.ts";
import type { BotHome, BotTaskCounts } from "./db.ts";
import { resolveBotStoragePaths } from "./storage.ts";

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

export interface ParsedBotYaml {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly version?: string;
  readonly sessionMode?: string;
}

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

function escapeMarkdownTableCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

function setBotYamlSummary(source: string, summary: string): string {
  const encoded = encodeJsonString(summary);
  if (/^summary\s*:/m.test(source)) {
    return source.replace(/^summary\s*:.*$/m, `summary: ${encoded}`);
  }
  return `${source.trimEnd()}\nsummary: ${encoded}\n`;
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
  taskCountsByBot?: ReadonlyMap<string, BotTaskCounts>,
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
    const counts = taskCountsByBot?.get(id);
    bots.push({
      id,
      name: parsed.name?.trim() || entry,
      status: parsed.status?.trim() || "draft",
      summary: parsed.summary?.trim() || "",
      version: parsed.version?.trim() || "0.1.0",
      sessionMode: parsed.sessionMode?.trim() || "fresh_per_run",
      skillsCount,
      activeTasksCount: counts?.active ?? 0,
      completedTasksCount: counts?.completed ?? 0,
      path: botDir,
      projectId: homesByBot?.get(id)?.projectId ?? null,
      homeThreadId: homesByBot?.get(id)?.homeThreadId ?? null,
    });
  }

  return bots;
});

export const listStateDirBots = Effect.fn("bot.listStateDirBots")(function* (
  stateDir: string,
  taskCountsByBot?: ReadonlyMap<string, BotTaskCounts>,
  homesByBot?: ReadonlyMap<string, BotHome>,
) {
  const paths = yield* resolveBotStoragePaths(stateDir);
  const bots = yield* listBotsInDirectory(paths.directory, taskCountsByBot, homesByBot);
  return {
    directory: paths.directory,
    bots,
  } satisfies BotListResponse;
});

const copyTemplateDirectory = Effect.fn("bot.copyTemplateDirectory")(function* (
  sourceDir: string,
  destDir: string,
  replacements: Readonly<Record<string, string>>,
  summaryOverride: string | undefined,
  isRootLevel: boolean,
): Effect.fn.Return<void, BotCreateIoError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs
    .makeDirectory(destDir, { recursive: true })
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  const entries = yield* fs
    .readDirectory(sourceDir)
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));

  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry);
    const dstPath = path.join(destDir, entry);
    const stat = yield* fs
      .stat(srcPath)
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    if (stat.type === "Directory") {
      yield* copyTemplateDirectory(srcPath, dstPath, replacements, summaryOverride, false);
      continue;
    }
    if (stat.type !== "File") continue;

    const raw = yield* fs
      .readFileString(srcPath)
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    const ext = path.extname(entry).toLowerCase();
    const jsonEscape = ext === ".yaml" || ext === ".yml" || ext === ".json" || ext === ".jsonl";
    let rendered = raw.replace(
      /\{\{(BOT_ID|BOT_NAME|CREATED_AT|CREATED_DATE)\}\}/g,
      (_match, key: string) => {
        const value = replacements[key] ?? "";
        return jsonEscape ? encodeJsonString(value).slice(1, -1) : value;
      },
    );
    if (isRootLevel && entry === "bot.yaml" && summaryOverride) {
      rendered = setBotYamlSummary(rendered, summaryOverride);
    }
    yield* fs
      .writeFileString(dstPath, rendered)
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  }
});

export const createBotInStateDir = Effect.fn("bot.createInStateDir")(function* (
  stateDir: string,
  input: BotCreateInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = input.name.trim();
  const summary = input.summary?.trim();

  if (!name) {
    return yield* new BotCreateValidationError({ detail: "Bot name is required." });
  }

  const paths = yield* resolveBotStoragePaths(stateDir);
  const existing = yield* listBotsInDirectory(paths.directory);
  if (existing.some((bot) => bot.name.toLowerCase() === name.toLowerCase())) {
    return yield* new BotCreateValidationError({
      detail: `A bot named "${name}" already exists.`,
    });
  }

  yield* fs
    .makeDirectory(paths.directory, { recursive: true })
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));

  const botId = NodeCrypto.randomUUID().toLowerCase();
  const botDir = path.join(paths.directory, botId);
  const nowIso = DateTime.formatIso(yield* DateTime.now);
  const createdDate = nowIso.slice(0, 10);
  const templateDir = path.join(paths.directory, "_template");

  if (yield* isDirectory(templateDir)) {
    yield* copyTemplateDirectory(
      templateDir,
      botDir,
      {
        BOT_ID: botId,
        BOT_NAME: name,
        CREATED_AT: nowIso,
        CREATED_DATE: createdDate,
      },
      summary,
      true,
    );
    yield* fs
      .makeDirectory(path.join(botDir, ".local", "eval-runs"), { recursive: true })
      .pipe(Effect.ignore);
    yield* fs.writeFileString(path.join(botDir, ".local", "metrics.jsonl"), "").pipe(Effect.ignore);

    const rosterPath = path.join(paths.directory, "_shared", "roster.md");
    if (yield* isFile(rosterPath)) {
      const rosterRaw = yield* fs.readFileString(rosterPath).pipe(Effect.orElseSucceed(() => ""));
      if (rosterRaw && !rosterRaw.includes(botId)) {
        const marker = "## 标准交接格式";
        const row = `| \`${botId}\` | ${escapeMarkdownTableCell(name)} | draft | ${escapeMarkdownTableCell(summary || "待补充")} | 待补充 |`;
        const markerIndex = rosterRaw.indexOf(marker);
        const updatedRoster =
          markerIndex >= 0
            ? `${rosterRaw.slice(0, markerIndex).trimEnd()}\n${row}\n\n${rosterRaw.slice(markerIndex)}`
            : `${rosterRaw.trimEnd()}\n${row}\n`;
        yield* fs.writeFileString(rosterPath, updatedRoster).pipe(Effect.ignore);
      }
    }
  } else {
    yield* fs
      .makeDirectory(path.join(botDir, "skills"), { recursive: true })
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    yield* fs
      .makeDirectory(path.join(botDir, "memory"), { recursive: true })
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    yield* fs
      .makeDirectory(path.join(botDir, "workspace"), { recursive: true })
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    const botYaml = [
      `id: ${encodeJsonString(botId)}`,
      `name: ${encodeJsonString(name)}`,
      `version: "0.1.0"`,
      `status: "active"`,
      `summary: ${encodeJsonString(summary || "")}`,
      "runtime:",
      `  session_mode: "ephemeral_task_thread"`,
      "",
    ].join("\n");
    yield* fs
      .writeFileString(path.join(botDir, "bot.yaml"), botYaml)
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
    yield* fs
      .writeFileString(
        path.join(botDir, "SOUL.md"),
        `# ${name}\n\n${summary ? `- 职责：${summary}\n` : ""}`,
      )
      .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
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
