import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  BOT_CREATE_ROUTE,
  BOT_HEALTH_ROUTE,
  BOT_LIST_ROUTE,
  BOT_TASKS_ROUTE_PREFIX,
  BotBindHomeInputSchema,
  BotCreateInputSchema,
  BotCreateTaskInputSchema,
  BotUpdateTaskInputSchema,
  type BotHealthResponse,
} from "../contracts.ts";
import { openBotStore, type BotHome, type BotStoreFailure } from "./db.ts";
import { startBotEventSyncWorker } from "./eventSync.ts";
import { BotNotFoundError, ensureBotHome, ensureBotProject, type BotHomeDeps } from "./home.ts";
import { BotServerHost, type BotHostError } from "./host.ts";
import { createBotInStateDir, listStateDirBots, type BotCreateFailure } from "./registry.ts";
import { resolveBotStoragePaths } from "./storage.ts";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

const decodeCreateBot = Schema.decodeUnknownEffect(BotCreateInputSchema);
const decodeBindHome = Schema.decodeUnknownEffect(BotBindHomeInputSchema);
const decodeCreateTask = Schema.decodeUnknownEffect(BotCreateTaskInputSchema);
const decodeUpdateTask = Schema.decodeUnknownEffect(BotUpdateTaskInputSchema);

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

function storeFailureResponse(error: BotStoreFailure) {
  switch (error._tag) {
    case "BotTaskNotFoundError":
      return jsonError(error.message, 404);
    case "BotStoreValidationError":
      return jsonError(error.message, 400);
    case "BotStoreError":
      return jsonError(error.message, 500);
  }
}

function homeFailureResponse(error: BotStoreFailure | BotNotFoundError | BotHostError) {
  switch (error._tag) {
    case "BotNotFoundError":
      return jsonError(error.message, 404);
    case "BotHostError":
      return jsonError(error.message, 502);
    default:
      return storeFailureResponse(error);
  }
}

function createBotFailureResponse(error: BotCreateFailure) {
  switch (error._tag) {
    case "BotCreateValidationError":
      return jsonError(error.message, 400);
    case "BotCreateIoError":
      return jsonError(error.message, 500);
  }
}

function parseTaskSubpath(originalUrl: string): ReadonlyArray<string> | null {
  const pathname = new URL(originalUrl, "http://localhost").pathname;
  const prefix = `${BOT_TASKS_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (!rest) return null;
  return rest.split("/").map((segment) => decodeURIComponent(segment));
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

    if (host.orchestration !== undefined) {
      yield* startBotEventSyncWorker(store, host.orchestration);
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
        const taskCounts = yield* store
          .getTaskCountsByBot()
          .pipe(Effect.orElseSucceed(() => new Map()));
        const homes = yield* store
          .getHomesByBot()
          .pipe(Effect.orElseSucceed(() => new Map<string, BotHome>()));
        const result = yield* listStateDirBots(stateDir, taskCounts, homes);
        return jsonOk(result);
      }),
    );

    const createBotRoute = HttpRouter.add(
      "POST",
      BOT_CREATE_ROUTE,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const raw = yield* request.json.pipe(Effect.option);
        if (raw._tag === "None") return jsonError("Invalid JSON body.", 400);
        const decoded = yield* decodeCreateBot(raw.value).pipe(Effect.option);
        if (decoded._tag === "None") return jsonError("Invalid create bot payload.", 400);
        const bot = yield* createBotInStateDir(stateDir, decoded.value);
        if (homeDeps === null) return jsonOk({ bot }, 201);
        // The bot exists on disk either way; Home retries the project on first open.
        const projectId = yield* ensureBotProject(homeDeps, bot).pipe(
          Effect.map((ensured) => ensured.projectId),
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logWarning("bot project creation failed", { botId: bot.id, cause }),
              null,
            ),
          ),
        );
        return jsonOk({ bot: { ...bot, projectId } }, 201);
      }).pipe(Effect.catch((error) => Effect.succeed(createBotFailureResponse(error)))),
    );

    const tasksWildcardRoute = HttpRouter.add(
      "*",
      `${BOT_TASKS_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const segments = parseTaskSubpath(request.originalUrl);
        if (!segments || segments.length === 0) {
          return jsonError("Missing botId.", 400);
        }

        const botId = segments[0] ?? "";

        // GET /api/bots/tasks/:botId
        if (request.method === "GET" && segments.length === 1) {
          const snapshot = yield* store.listBotTasks(botId);
          return jsonOk(snapshot);
        }

        // PUT /api/bots/tasks/:botId/home
        if (request.method === "PUT" && segments.length === 2 && segments[1] === "home") {
          const raw = yield* request.json.pipe(Effect.option);
          if (raw._tag === "None") return jsonError("Invalid JSON body.", 400);
          const decoded = yield* decodeBindHome(raw.value).pipe(Effect.option);
          if (decoded._tag === "None") return jsonError("Invalid home binding payload.", 400);
          const home = yield* store.upsertHome(botId, decoded.value);
          return jsonOk({ home });
        }

        // POST /api/bots/tasks/:botId/home
        if (request.method === "POST" && segments.length === 2 && segments[1] === "home") {
          if (homeDeps === null) return jsonError("Bot orchestration is unavailable.", 503);
          const home = yield* homeLock.withPermits(1)(ensureBotHome(homeDeps, botId));
          return jsonOk({ home });
        }

        // POST /api/bots/tasks/:botId
        if (request.method === "POST" && segments.length === 1) {
          const raw = yield* request.json.pipe(Effect.option);
          if (raw._tag === "None") return jsonError("Invalid JSON body.", 400);
          const decoded = yield* decodeCreateTask(raw.value).pipe(Effect.option);
          if (decoded._tag === "None") return jsonError("Invalid create task payload.", 400);
          const created = yield* store.createTask(botId, decoded.value);
          return jsonOk(created, 201);
        }

        // PATCH /api/bots/tasks/:botId/:taskId
        if (request.method === "PATCH" && segments.length === 2) {
          const taskId = segments[1] ?? "";
          const raw = yield* request.json.pipe(Effect.option);
          if (raw._tag === "None") return jsonError("Invalid JSON body.", 400);
          const decoded = yield* decodeUpdateTask(raw.value).pipe(Effect.option);
          if (decoded._tag === "None") return jsonError("Invalid update task payload.", 400);
          const updated = yield* store.updateTask(botId, taskId, decoded.value);
          return jsonOk(updated);
        }

        // DELETE /api/bots/tasks/:botId/:taskId
        if (request.method === "DELETE" && segments.length === 2) {
          const taskId = segments[1] ?? "";
          const deleted = yield* store.deleteTask(botId, taskId);
          return deleted ? jsonOk({ deleted: true }) : jsonError(`Task not found: ${taskId}`, 404);
        }

        return jsonError("Bot tasks endpoint not found.", 404);
      }).pipe(Effect.catch((error) => Effect.succeed(homeFailureResponse(error)))),
    );

    return Layer.mergeAll(healthRoute, listBotsRoute, createBotRoute, tasksWildcardRoute);
  }),
);
