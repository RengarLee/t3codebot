import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { BOT_HEALTH_ROUTE, BOT_LIST_ROUTE, type BotHealthResponse } from "../contracts.ts";
import { BotServerHost } from "./host.ts";
import { listStateDirBots } from "./registry.ts";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

export const createBotHealthPayload = (botsCount = 0): BotHealthResponse => ({
  ok: true,
  module: "t3codebot",
  botsCount,
});

function jsonOk(payload: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Single mount point for all bot HTTP routes under `/api/bots/*`.
 * Mounted with minimal glue in `apps/server/src/server.ts` so future bot endpoints
 * never expand the upstream diff.
 */
export const botHttpRoutesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* BotServerHost;

    const healthRoute = HttpRouter.add(
      "GET",
      BOT_HEALTH_ROUTE,
      Effect.gen(function* () {
        const { bots } = yield* listStateDirBots(stateDir);
        return jsonOk(createBotHealthPayload(bots.length));
      }),
    );

    const listBotsRoute = HttpRouter.add(
      "GET",
      BOT_LIST_ROUTE,
      Effect.gen(function* () {
        const result = yield* listStateDirBots(stateDir);
        return jsonOk(result);
      }),
    );

    return Layer.mergeAll(healthRoute, listBotsRoute);
  }),
);
