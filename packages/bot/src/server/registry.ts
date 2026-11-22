import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { BotListResponse, BotSummary } from "../contracts.ts";
import { resolveBotStoragePaths } from "./storage.ts";

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
    const skillsCount = yield* countBotLocalSkills(botDir);
    bots.push({
      id: parsed.id?.trim() || entry,
      name: parsed.name?.trim() || entry,
      status: parsed.status?.trim() || "draft",
      summary: parsed.summary?.trim() || "",
      version: parsed.version?.trim() || "0.1.0",
      sessionMode: parsed.sessionMode?.trim() || "fresh_per_run",
      skillsCount,
      path: botDir,
    });
  }

  return bots;
});

export const listStateDirBots = Effect.fn("bot.listStateDirBots")(function* (stateDir: string) {
  const paths = yield* resolveBotStoragePaths(stateDir);
  const bots = yield* listBotsInDirectory(paths.directory);
  return {
    directory: paths.directory,
    bots,
  } satisfies BotListResponse;
});
