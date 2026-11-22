import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { BOT_HEALTH_ROUTE, type BotHealthResponse } from "../contracts.ts";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

export const createBotHealthPayload = (): BotHealthResponse => ({
  ok: true,
  module: "t3codebot",
  botsCount: 0,
});

const healthRoute = HttpRouter.add(
  "GET",
  BOT_HEALTH_ROUTE,
  Effect.sync(() =>
    HttpServerResponse.jsonUnsafe(createBotHealthPayload(), {
      status: 200,
      headers: NO_STORE_HEADERS,
    }),
  ),
);

/**
 * Single mount point for all bot HTTP routes under `/api/bots/*`.
 * Mounted with one line in `apps/server/src/server.ts` so future bot endpoints
 * never expand the upstream diff.
 */
export const botHttpRoutesLayer = Layer.mergeAll(healthRoute);
