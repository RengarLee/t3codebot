import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { BotSummary } from "../contracts.ts";
import type { BotStoreShape } from "./db.ts";
import type { BotHostOrchestrationShape } from "./host.ts";
import {
  BotCreateIoError,
  listStateDirBots,
  parseBotYaml,
  writeFileIfChanged,
} from "./registry.ts";
import { botSkillRoots } from "./skillRoots.ts";
import { renderSubBotInstructions } from "./template.ts";
import { botProjectFolders } from "./workingFolders.ts";

export interface BotInstructionsDeps {
  readonly stateDir: string;
  readonly orchestration?: BotHostOrchestrationShape | undefined;
}

/**
 * Rewrites a sub-bot's `workspace/AGENTS.md` from its `bot.yaml` (code projects) and the summary
 * given (name, working folders), so every caller renders the same file.
 */
export const refreshSubBotInstructions = Effect.fn("bot.instructions.refreshSubBot")(function* (
  deps: BotInstructionsDeps,
  bot: BotSummary,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const yaml = yield* fs
    .readFileString(path.join(bot.path, "bot.yaml"))
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  const projectFolders = (parseBotYaml(yaml).projects ?? []).filter(path.isAbsolute);
  const { orchestration } = deps;
  const codeProjects =
    orchestration === undefined
      ? []
      : yield* Effect.forEach(projectFolders, (folder) =>
          orchestration
            .ensureProject({ workspaceRoot: folder, title: path.basename(folder) })
            .pipe(Effect.map(({ projectId }) => ({ folder, projectId }))),
        );
  yield* writeFileIfChanged(
    path.join(bot.path, "workspace", "AGENTS.md"),
    renderSubBotInstructions(bot, codeProjects, bot.workingFolders, botSkillRoots(path, bot)),
  );
});

/**
 * Brings bots made before skills had a history up to date: sub-bots get the Skills section in
 * their instructions, and every bot's project is granted the two skill folders. The main bot's
 * instructions are rewritten by `ensureMainBotInStateDir`. One failing bot never blocks the rest.
 */
export const refreshBotsForSkills = Effect.fn("bot.instructions.refreshForSkills")(function* (
  deps: BotInstructionsDeps & { readonly store: BotStoreShape },
) {
  const path = yield* Path.Path;
  const homes = yield* deps.store.getHomesByBot();
  const { bots } = yield* listStateDirBots(deps.stateDir, homes);
  const { orchestration } = deps;
  for (const bot of bots) {
    if (bot.role === "sub") {
      yield* refreshSubBotInstructions(deps, bot).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("bot skills instructions refresh failed", { botId: bot.id, cause }),
        ),
      );
    }
    if (orchestration === undefined || bot.projectId === null) continue;
    yield* orchestration
      .syncProjectFolders({
        projectId: bot.projectId,
        folders: botProjectFolders(path, bot, bot.workingFolders),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("bot skills folder grant failed", { botId: bot.id, cause }),
        ),
      );
  }
});
