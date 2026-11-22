import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { BotSummary } from "../contracts.ts";
import type { BotStoreShape } from "./db.ts";
import type { BotHostOrchestrationShape } from "./host.ts";
import { listStateDirBots } from "./registry.ts";

export class BotNotFoundError extends Schema.TaggedError<
  BotNotFoundError,
  { readonly brand: unique symbol }
>()("BotNotFoundError", {
  botId: Schema.String,
}) {
  override get message(): string {
    return `Bot not found: ${this.botId}`;
  }
}

export interface BotHomeDeps {
  readonly stateDir: string;
  readonly store: BotStoreShape;
  readonly orchestration: BotHostOrchestrationShape;
}

/** A bot is a T3 project rooted at its `workspace/` folder; the project id is cached in bots.sqlite. */
export const ensureBotProject = Effect.fn("bot.home.ensureProject")(function* (
  deps: BotHomeDeps,
  bot: BotSummary,
) {
  const path = yield* Path.Path;
  const { projectId } = yield* deps.orchestration.ensureProject({
    workspaceRoot: path.join(bot.path, "workspace"),
    title: bot.name,
  });
  const home = yield* deps.store.getHome(bot.id);
  if (home !== null && home.projectId === projectId) return { home, projectId };
  const updated = yield* deps.store.upsertHome(bot.id, {
    homeThreadId: home?.homeThreadId ?? null,
    projectId,
  });
  return { home: updated, projectId };
});

/** Returns the bot's Home thread, launching a new one when none is bound or the bound one is gone. */
export const ensureBotHome = Effect.fn("bot.home.ensure")(function* (
  deps: BotHomeDeps,
  botId: string,
) {
  const { bots } = yield* listStateDirBots(deps.stateDir);
  const bot = bots.find((candidate) => candidate.id === botId);
  if (bot === undefined) return yield* new BotNotFoundError({ botId });

  const { home, projectId } = yield* ensureBotProject(deps, bot);
  if (home.homeThreadId !== null) {
    const thread = yield* deps.orchestration.getThread(home.homeThreadId);
    if (thread !== null && thread.projectId === projectId) return home;
  }

  const launched = yield* deps.orchestration.launchThread({
    projectId,
    title: `${bot.name} Home`,
  });
  return yield* deps.store.upsertHome(bot.id, {
    homeThreadId: launched.threadId,
    projectId: launched.projectId,
  });
});
