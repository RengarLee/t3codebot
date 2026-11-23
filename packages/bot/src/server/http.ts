import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  BOT_HEALTH_ROUTE,
  BOT_HOME_ROUTE_PREFIX,
  BOT_LIST_ROUTE,
  MAIN_BOT_ID,
  type BotHealthResponse,
} from "../contracts.ts";
import { openBotStore, type BotHome } from "./db.ts";
import { startBotEventSyncWorker } from "./eventSync.ts";
import { ensureBotHome, type BotHomeDeps } from "./home.ts";
import { BotServerHost } from "./host.ts";
import { ensureMainBotInStateDir, listStateDirBots } from "./registry.ts";
import { resolveBotStoragePaths } from "./storage.ts";

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

function jsonError(message: string, status = 400) {
  return HttpServerResponse.jsonUnsafe(
    { ok: false, error: message },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

function parseHomeBotId(originalUrl: string): string | null {
  const pathname = new URL(originalUrl, "http://localhost").pathname;
  const prefix = `${BOT_HOME_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  return rest && !rest.includes("/") ? decodeURIComponent(rest) : null;
}

/**
 * Single mount point for all bot HTTP routes under `/api/bots/*`.
 * Mounted via `apps/server/src/botHostAdapter.ts` so upstream `server.ts` stays minimal.
 */
export const botHttpRoutesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const host = yield* BotServerHost;
    const { stateDir } = host;
    const paths = yield* resolveBotStoragePaths(stateDir);
    const store = yield* openBotStore(paths.sqlitePath);

    const homeDeps: BotHomeDeps | null =
      host.orchestration === undefined
        ? null
        : { stateDir, store, orchestration: host.orchestration };
    // Two clients opening Home at once must not launch two Home threads.
    const homeLock = yield* Semaphore.make(1);

    // Concurrent first requests must not write the main bot's directory twice.
    const mainBotLock = yield* Semaphore.make(1);
    const ensureMainBot = mainBotLock
      .withPermits(1)(ensureMainBotInStateDir(stateDir))
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning("bot main bot creation failed", { cause })),
      );
    yield* ensureMainBot;

    if (homeDeps !== null) {
      yield* startBotEventSyncWorker(homeDeps);
      // Best effort so the first click opens instantly; the sidebar retries on demand.
      yield* homeLock
        .withPermits(1)(ensureBotHome(homeDeps, MAIN_BOT_ID))
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("bot main Home warmup failed", { cause })),
          Effect.forkScoped,
        );
    }

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
        yield* ensureMainBot;
        const homes = yield* store
          .getHomesByBot()
          .pipe(Effect.orElseSucceed(() => new Map<string, BotHome>()));
        const result = yield* listStateDirBots(stateDir, homes);
        return jsonOk(result);
      }),
    );

    // POST /api/bots/home/:botId
    const homeRoute = HttpRouter.add(
      "POST",
      `${BOT_HOME_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const botId = parseHomeBotId(request.originalUrl);
        if (botId === null) return jsonError("Missing botId.", 400);
        if (homeDeps === null) return jsonError("Bot orchestration is unavailable.", 503);
        const home = yield* homeLock.withPermits(1)(ensureBotHome(homeDeps, botId));
        return jsonOk({ home });
      }).pipe(
        Effect.catchTags({
          BotNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          BotHostError: (error) => Effect.succeed(jsonError(error.message, 502)),
          BotStoreError: (error) => Effect.succeed(jsonError(error.message, 500)),
        }),
      ),
    );

    return Layer.mergeAll(healthRoute, listBotsRoute, homeRoute);
  }),
);
