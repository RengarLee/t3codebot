import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { MAIN_BOT_ID } from "../contracts.ts";
import { BotNotFoundError } from "./home.ts";
import { refreshSubBotInstructions } from "./instructions.ts";
import {
  BotCreateIoError,
  ensureMainBotInStateDir,
  listStateDirBots,
  upsertYamlStringField,
  writeFileIfChanged,
} from "./registry.ts";
import type { BotWorkingFoldersDeps } from "./workingFolders.ts";

const BOT_NAME_MAX_LENGTH = 128;
const BOT_SUMMARY_MAX_LENGTH = 500;

export class BotProfileValidationError extends Schema.TaggedError<
  BotProfileValidationError,
  { readonly brand: unique symbol }
>()("BotProfileValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface BotProfileUpdateInput {
  readonly name?: string | undefined;
  readonly summary?: string | undefined;
}

/**
 * Renames a bot or changes its summary in `bot.yaml`, updates its backing T3 project title when
 * present, and refreshes bot instructions so the main bot roster stays in sync.
 */
export const updateBotProfile = Effect.fn("bot.profile.update")(function* (
  deps: BotWorkingFoldersDeps,
  botId: string,
  input: BotProfileUpdateInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homes = yield* deps.store.getHomesByBot();
  const { bots } = yield* listStateDirBots(deps.stateDir, homes);
  const bot = bots.find((candidate) => candidate.id === botId);
  if (bot === undefined) {
    return yield* new BotNotFoundError({ botId });
  }
  const name = input.name?.trim() ?? bot.name;
  const summary = input.summary?.trim() ?? bot.summary;
  if (name.length === 0) {
    return yield* new BotProfileValidationError({ detail: "Bot name cannot be empty." });
  }
  if (name.length > BOT_NAME_MAX_LENGTH) {
    return yield* new BotProfileValidationError({
      detail: `Bot name must be at most ${BOT_NAME_MAX_LENGTH} characters.`,
    });
  }
  if (summary.length > BOT_SUMMARY_MAX_LENGTH) {
    return yield* new BotProfileValidationError({
      detail: `Bot summary must be at most ${BOT_SUMMARY_MAX_LENGTH} characters.`,
    });
  }
  if (
    bot.role === "sub" &&
    bots.some(
      (candidate) =>
        candidate.id !== bot.id &&
        candidate.role === "sub" &&
        candidate.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return yield* new BotProfileValidationError({
      detail: `A sub-bot named "${name}" already exists.`,
    });
  }

  if (bot.name === name && bot.summary === summary) {
    return bot;
  }

  if (bot.name !== name && deps.orchestration !== undefined && bot.projectId !== null) {
    yield* deps.orchestration.updateProjectTitle({
      projectId: bot.projectId,
      title: name,
    });
  }

  const yamlPath = path.join(bot.path, "bot.yaml");
  const currentYaml = yield* fs
    .readFileString(yamlPath)
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  const nextYaml = upsertYamlStringField(
    upsertYamlStringField(currentYaml, "name", name),
    "summary",
    summary,
  );
  yield* writeFileIfChanged(yamlPath, nextYaml);

  const refreshedHomes = yield* deps.store.getHomesByBot();
  if (bot.id !== MAIN_BOT_ID) {
    yield* refreshSubBotInstructions(deps, { ...bot, name, summary });
  }
  yield* ensureMainBotInStateDir(deps.stateDir, refreshedHomes);

  const updated = (yield* listStateDirBots(deps.stateDir, refreshedHomes)).bots.find(
    (candidate) => candidate.id === botId,
  );
  if (updated === undefined) {
    return yield* new BotNotFoundError({ botId });
  }
  return updated;
});
