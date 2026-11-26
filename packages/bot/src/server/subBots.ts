import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import type { BotSubBotSpec } from "../contracts.ts";
import { ensureBotProject, type BotHomeDeps } from "./home.ts";
import { refreshSubBotInstructions } from "./instructions.ts";
import { createBotInStateDir, ensureMainBotInStateDir } from "./registry.ts";

/**
 * Builds a sub-bot from the spec a "Create sub-bot" session handed back: its folder, its own T3
 * project, its instructions, and the main bot's refreshed roster.
 */
export const createSubBot = Effect.fn("bot.subBot.create")(function* (
  deps: BotHomeDeps,
  spec: BotSubBotSpec,
) {
  const path = yield* Path.Path;
  const folders = [
    ...new Set(spec.projects.map((folder) => folder.trim()).filter(path.isAbsolute)),
  ];
  // Created first: a duplicate name fails here, before any code project is touched.
  const bot = yield* createBotInStateDir(deps.stateDir, {
    name: spec.name,
    summary: spec.summary,
    inScope: spec.inScope,
    outOfScope: spec.outOfScope,
    persona: spec.persona,
    projects: folders,
  });

  yield* refreshSubBotInstructions(deps, bot);
  const { projectId } = yield* ensureBotProject(deps, bot);

  yield* ensureMainBotInStateDir(deps.stateDir, yield* deps.store.getHomesByBot());
  return { bot, projectId };
});
