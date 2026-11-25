// @effect-diagnostics nodeBuiltinImport:off -- Uses node:os for ~ home-directory expansion.
import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BOT_WORKING_FOLDERS_MAX, MAIN_BOT_ID } from "../contracts.ts";
import { BotNotFoundError, ensureBotProject, type BotHomeDeps } from "./home.ts";
import type { BotHostTrackedFolder } from "./host.ts";
import {
  BotCreateIoError,
  ensureMainBotInStateDir,
  listStateDirBots,
  parseBotYaml,
  upsertYamlStringListField,
  writeFileIfChanged,
} from "./registry.ts";
import { renderSubBotInstructions } from "./template.ts";

export class BotWorkingFoldersValidationError extends Schema.TaggedError<
  BotWorkingFoldersValidationError,
  { readonly brand: unique symbol }
>()("BotWorkingFoldersValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const FOLDER_NAME_MAX = 128;

function expandLeadingTilde(path: Path.Path, rawFolder: string): string {
  if (rawFolder === "~") return NodeOS.homedir();
  if (rawFolder.startsWith("~/") || rawFolder.startsWith("~\\")) {
    return path.join(NodeOS.homedir(), rawFolder.slice(2));
  }
  return rawFolder;
}

function normalizeComparisonKey(path: Path.Path, folderPath: string): string {
  return path.sep === "\\" ? folderPath.toLowerCase() : folderPath;
}

function isWithinDirectory(path: Path.Path, candidate: string, root: string): boolean {
  const relative = path.relative(
    normalizeComparisonKey(path, root),
    normalizeComparisonKey(path, candidate),
  );
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function toBotTrackedFolders(
  path: Path.Path,
  folders: ReadonlyArray<string>,
): ReadonlyArray<BotHostTrackedFolder> {
  return folders.map((folderPath) => {
    const base = path.basename(folderPath).trim();
    const fallback = folderPath.replace(/[\\/]+$/, "") || folderPath;
    const name = (base || fallback).slice(0, FOLDER_NAME_MAX).trim() || "folder";
    return { path: folderPath, name };
  });
}

const normalizeWorkingFolders = Effect.fn("bot.workingFolders.normalize")(function* (
  workspaceRoot: string,
  rawFolders: ReadonlyArray<string>,
  existingFolders: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const existingKeys = new Set(
    existingFolders.map((folder) => normalizeComparisonKey(path, path.resolve(folder))),
  );
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawEntry of rawFolders) {
    const trimmed = rawEntry.trim();
    if (trimmed.length === 0) {
      return yield* new BotWorkingFoldersValidationError({
        detail: "Folder path cannot be empty.",
      });
    }
    const expanded = expandLeadingTilde(path, trimmed);
    if (!path.isAbsolute(expanded)) {
      return yield* new BotWorkingFoldersValidationError({
        detail: `Folder '${trimmed}' must be an absolute path.`,
      });
    }
    const resolved = path.resolve(expanded);
    if (
      normalizeComparisonKey(path, resolved) === normalizeComparisonKey(path, resolvedWorkspace)
    ) {
      return yield* new BotWorkingFoldersValidationError({
        detail: "The bot's own workspace folder is always accessible; choose another folder.",
      });
    }
    if (isWithinDirectory(path, resolvedWorkspace, resolved)) {
      return yield* new BotWorkingFoldersValidationError({
        detail: `Folder '${resolved}' contains the bot's own workspace folder.`,
      });
    }
    if (isWithinDirectory(path, resolved, resolvedWorkspace)) {
      return yield* new BotWorkingFoldersValidationError({
        detail: `Folder '${resolved}' is already inside the bot's own workspace.`,
      });
    }
    const key = normalizeComparisonKey(path, resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(resolved);
  }

  if (normalized.length > BOT_WORKING_FOLDERS_MAX) {
    return yield* new BotWorkingFoldersValidationError({
      detail: `A bot can configure at most ${BOT_WORKING_FOLDERS_MAX} working folders.`,
    });
  }

  for (const folderPath of normalized) {
    if (existingKeys.has(normalizeComparisonKey(path, folderPath))) continue;
    const stat = yield* fs.stat(folderPath).pipe(Effect.option);
    if (stat._tag === "None" || stat.value.type !== "Directory") {
      return yield* new BotWorkingFoldersValidationError({
        detail: `'${folderPath}' is not an existing folder on this machine.`,
      });
    }
  }

  return normalized;
});

export interface BotWorkingFoldersDeps {
  readonly stateDir: string;
  readonly store: BotHomeDeps["store"];
  readonly orchestration?: BotHomeDeps["orchestration"] | undefined;
}

/**
 * Updates a bot's allowed working folders across `bot.yaml`, its T3 project's `trackedFolders`,
 * and its standing `workspace/AGENTS.md` instructions.
 */
export const updateBotWorkingFolders = Effect.fn("bot.workingFolders.update")(function* (
  deps: BotWorkingFoldersDeps,
  botId: string,
  rawFolders: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homes = yield* deps.store.getHomesByBot();
  const { bots } = yield* listStateDirBots(deps.stateDir, homes);
  const bot = bots.find((candidate) => candidate.id === botId);
  if (bot === undefined) {
    return yield* new BotNotFoundError({ botId });
  }

  const workspaceRoot = path.join(bot.path, "workspace");
  const workingFolders = yield* normalizeWorkingFolders(
    workspaceRoot,
    rawFolders,
    bot.workingFolders,
  );

  // Sync T3 project trackedFolders first so any host validation failure leaves bot.yaml untouched.
  if (deps.orchestration !== undefined) {
    const homeDeps: BotHomeDeps = {
      stateDir: deps.stateDir,
      store: deps.store,
      orchestration: deps.orchestration,
    };
    const { projectId } = yield* ensureBotProject(homeDeps, bot);
    yield* deps.orchestration.syncProjectFolders({
      projectId,
      folders: toBotTrackedFolders(path, workingFolders),
    });
  }

  const yamlPath = path.join(bot.path, "bot.yaml");
  const currentYaml = yield* fs
    .readFileString(yamlPath)
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  const nextYaml = upsertYamlStringListField(currentYaml, "working_folders", workingFolders);
  yield* writeFileIfChanged(yamlPath, nextYaml);

  const refreshedHomes = yield* deps.store.getHomesByBot();
  if (bot.id === MAIN_BOT_ID) {
    yield* ensureMainBotInStateDir(deps.stateDir, refreshedHomes);
  } else {
    const parsed = parseBotYaml(nextYaml);
    const projectFolders = (parsed.projects ?? []).filter(path.isAbsolute);
    const orchestration = deps.orchestration;
    const codeProjects =
      orchestration === undefined
        ? []
        : yield* Effect.forEach(projectFolders, (folder) =>
            orchestration
              .ensureProject({ workspaceRoot: folder, title: path.basename(folder) })
              .pipe(Effect.map(({ projectId }) => ({ folder, projectId }))),
          );
    yield* writeFileIfChanged(
      path.join(workspaceRoot, "AGENTS.md"),
      renderSubBotInstructions(bot, codeProjects, workingFolders),
    );
  }

  const updated = (yield* listStateDirBots(deps.stateDir, refreshedHomes)).bots.find(
    (candidate) => candidate.id === botId,
  );
  if (updated === undefined) {
    return yield* new BotNotFoundError({ botId });
  }
  return updated;
});
