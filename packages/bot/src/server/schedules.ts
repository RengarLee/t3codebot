import * as Effect from "effect/Effect";
import { type BotScheduleUpdate } from "../contracts.ts";
import type { BotStore } from "./db.ts";
import { BotHostError, type BotServerHostShape } from "./host.ts";

export const runBotScheduleCommand = Effect.fn("bot.schedules.command")(function* (
  host: BotServerHostShape,
  store: BotStore["Service"],
  input: { readonly botId: string } | BotScheduleUpdate,
) {
  if (host.schedules === undefined)
    return yield* new BotHostError({
      operation: "schedules",
      detail: "Scheduled tasks are unavailable.",
    });
  const home = yield* store.getHome(input.botId);
  if (home?.projectId == null)
    return yield* new BotHostError({ operation: "schedules", detail: "Bot project not found." });
  if ("kind" in input) yield* host.schedules.update(home.projectId, input);
  return yield* host.schedules.list(home.projectId);
});
