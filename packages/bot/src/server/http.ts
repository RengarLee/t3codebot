import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  BOT_FILE_COMMANDS,
  BOT_FILES_ROUTE_PREFIX,
  BOT_HEALTH_ROUTE,
  BOT_HOME_ROUTE_PREFIX,
  BOT_LIST_ROUTE,
  BOT_PROFILE_ROUTE_PREFIX,
  BOT_SKILL_COMMANDS,
  BOT_SKILLS_ROUTE_PREFIX,
  BOT_WORKING_FOLDERS_ROUTE_PREFIX,
  BotUpdateProfileRequestSchema,
  BotUpdateWorkingFoldersRequestSchema,
  MAIN_BOT_ID,
  type BotHealthResponse,
} from "../contracts.ts";
import { runBotFileCommand } from "./botFiles.ts";
import { openBotStore, type BotHome } from "./db.ts";
import { startBotEventSyncWorker } from "./eventSync.ts";
import { ensureBotHome, type BotHomeDeps } from "./home.ts";
import { BotServerHost } from "./host.ts";
import { refreshBotsForSkills } from "./instructions.ts";
import { updateBotProfile } from "./profile.ts";
import { ensureMainBotInStateDir, listStateDirBots } from "./registry.ts";
import { makeSkillReview } from "./skillReview.ts";
import { installBuiltinSkills, runSkillCommand, type SkillCommandDeps } from "./skills.ts";
import { resolveBotStoragePaths } from "./storage.ts";
import { updateBotWorkingFolders } from "./workingFolders.ts";

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

function parseBotIdParam(originalUrl: string, routePrefix: string): string | null {
  const pathname = new URL(originalUrl, "http://localhost").pathname;
  const prefix = `${routePrefix}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  return rest && !rest.includes("/") ? decodeURIComponent(rest) : null;
}

/** The `<command>` of `<routePrefix>/<command>`; commands may hold one slash (`suggestions/accept`). */
function parseCommandParam(originalUrl: string, routePrefix: string): string | null {
  const pathname = new URL(originalUrl, "http://localhost").pathname;
  const prefix = `${routePrefix}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  return rest ? decodeURIComponent(rest) : null;
}

const decodeUpdateWorkingFoldersRequest = Schema.decodeUnknownEffect(
  BotUpdateWorkingFoldersRequestSchema,
);
const decodeUpdateProfileRequest = Schema.decodeUnknownEffect(BotUpdateProfileRequestSchema);

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
      .withPermits(1)(
        store
          .getHomesByBot()
          .pipe(Effect.flatMap((homes) => ensureMainBotInStateDir(stateDir, homes))),
      )
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning("bot main bot creation failed", { cause })),
      );
    yield* ensureMainBot;

    // Background review of chats; its timers and loop live as long as this layer.
    const skillReview = homeDeps === null ? undefined : yield* makeSkillReview(homeDeps);

    const skillDeps: SkillCommandDeps = {
      stateDir,
      store,
      ...(skillReview === undefined ? {} : { skillReview }),
      ...(homeDeps === null
        ? {}
        : {
            orchestration: homeDeps.orchestration,
            ensureHome: (botId: string) => homeLock.withPermits(1)(ensureBotHome(homeDeps, botId)),
          }),
    };
    // The shipped skill and the Skills section reach bots made before they existed.
    yield* installBuiltinSkills(skillDeps).pipe(
      Effect.andThen(
        refreshBotsForSkills({
          stateDir,
          store,
          ...(host.orchestration !== undefined ? { orchestration: host.orchestration } : {}),
        }),
      ),
      Effect.catchCause((cause) => Effect.logWarning("bot skills startup failed", { cause })),
    );

    if (homeDeps !== null) {
      yield* startBotEventSyncWorker(homeDeps, skillReview);
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
        let homes = yield* store
          .getHomesByBot()
          .pipe(Effect.orElseSucceed(() => new Map<string, BotHome>()));
        if (homeDeps !== null && homes.get(MAIN_BOT_ID)?.projectId == null) {
          yield* homeLock
            .withPermits(1)(ensureBotHome(homeDeps, MAIN_BOT_ID))
            .pipe(Effect.catchCause(() => Effect.void));
          homes = yield* store
            .getHomesByBot()
            .pipe(Effect.orElseSucceed(() => new Map<string, BotHome>()));
        }
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
        const botId = parseBotIdParam(request.originalUrl, BOT_HOME_ROUTE_PREFIX);
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

    // POST /api/bots/working-folders/:botId (POST stays within T3's CORS allowed methods).
    const workingFoldersRoute = HttpRouter.add(
      "POST",
      `${BOT_WORKING_FOLDERS_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const botId = parseBotIdParam(request.originalUrl, BOT_WORKING_FOLDERS_ROUTE_PREFIX);
        if (botId === null) return jsonError("Missing botId.", 400);
        const rawBody = yield* request.json.pipe(Effect.option);
        if (rawBody._tag === "None") return jsonError("Invalid JSON request body.", 400);
        const decoded = yield* decodeUpdateWorkingFoldersRequest(rawBody.value).pipe(Effect.option);
        if (decoded._tag === "None") {
          return jsonError("Expected { workingFolders: string[] }.", 400);
        }
        yield* ensureMainBot;
        const bot = yield* homeLock.withPermits(1)(
          updateBotWorkingFolders(
            {
              stateDir,
              store,
              ...(host.orchestration !== undefined ? { orchestration: host.orchestration } : {}),
            },
            botId,
            decoded.value.workingFolders,
          ),
        );
        return jsonOk({ bot });
      }).pipe(
        Effect.catchTags({
          BotNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          BotWorkingFoldersValidationError: (error) =>
            Effect.succeed(jsonError(error.message, 400)),
          BotCreateValidationError: (error) => Effect.succeed(jsonError(error.message, 400)),
          BotHostError: (error) => Effect.succeed(jsonError(error.message, 502)),
          BotCreateIoError: (error) => Effect.succeed(jsonError(error.message, 500)),
          BotStoreError: (error) => Effect.succeed(jsonError(error.message, 500)),
        }),
      ),
    );

    // POST /api/bots/profile/:botId (POST stays within T3's CORS allowed methods).
    const profileRoute = HttpRouter.add(
      "POST",
      `${BOT_PROFILE_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const botId = parseBotIdParam(request.originalUrl, BOT_PROFILE_ROUTE_PREFIX);
        if (botId === null) return jsonError("Missing botId.", 400);
        const rawBody = yield* request.json.pipe(Effect.option);
        if (rawBody._tag === "None") return jsonError("Invalid JSON request body.", 400);
        const decoded = yield* decodeUpdateProfileRequest(rawBody.value).pipe(Effect.option);
        if (decoded._tag === "None") {
          return jsonError("Expected { name?: string, summary?: string }.", 400);
        }
        yield* ensureMainBot;
        const bot = yield* homeLock.withPermits(1)(
          updateBotProfile(
            {
              stateDir,
              store,
              ...(host.orchestration !== undefined ? { orchestration: host.orchestration } : {}),
            },
            botId,
            decoded.value,
          ),
        );
        return jsonOk({ bot });
      }).pipe(
        Effect.catchTags({
          BotNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          BotProfileValidationError: (error) => Effect.succeed(jsonError(error.message, 400)),
          BotCreateValidationError: (error) => Effect.succeed(jsonError(error.message, 400)),
          BotHostError: (error) => Effect.succeed(jsonError(error.message, 502)),
          BotCreateIoError: (error) => Effect.succeed(jsonError(error.message, 500)),
          BotStoreError: (error) => Effect.succeed(jsonError(error.message, 500)),
        }),
      ),
    );

    // POST /api/bots/skills/<command>: skill list, history, edits, and suggestions.
    const skillsRoute = HttpRouter.add(
      "POST",
      `${BOT_SKILLS_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const command = parseCommandParam(request.originalUrl, BOT_SKILLS_ROUTE_PREFIX);
        if (command === null || !Object.values<string>(BOT_SKILL_COMMANDS).includes(command)) {
          return jsonError("Unknown skill command.", 404);
        }
        const rawBody = yield* request.json.pipe(Effect.option);
        if (rawBody._tag === "None") return jsonError("Invalid JSON request body.", 400);
        yield* ensureMainBot;
        return jsonOk(yield* runSkillCommand(skillDeps, command, rawBody.value));
      }).pipe(
        Effect.catchTags({
          SkillValidationError: (error) => Effect.succeed(jsonError(error.message, 400)),
          SkillNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          BotNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          SkillConflictError: (error) => Effect.succeed(jsonError(error.message, 409)),
          SkillUnavailableError: (error) => Effect.succeed(jsonError(error.message, 503)),
          BotHostError: (error) => Effect.succeed(jsonError(error.message, 502)),
          BotCreateIoError: (error) => Effect.succeed(jsonError(error.message, 500)),
          BotStoreError: (error) => Effect.succeed(jsonError(error.message, 500)),
        }),
      ),
    );

    // Saves compare against the file on disk, so two saves must not interleave.
    const filesLock = yield* Semaphore.make(1);

    // POST /api/bots/files/<command>: a bot's persona, lessons, and memory files.
    const filesRoute = HttpRouter.add(
      "POST",
      `${BOT_FILES_ROUTE_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const command = parseCommandParam(request.originalUrl, BOT_FILES_ROUTE_PREFIX);
        if (command === null || !Object.values<string>(BOT_FILE_COMMANDS).includes(command)) {
          return jsonError("Unknown file command.", 404);
        }
        const rawBody = yield* request.json.pipe(Effect.option);
        if (rawBody._tag === "None") return jsonError("Invalid JSON request body.", 400);
        yield* ensureMainBot;
        return jsonOk(
          yield* filesLock.withPermits(1)(runBotFileCommand(stateDir, command, rawBody.value)),
        );
      }).pipe(
        Effect.catchTags({
          BotFileValidationError: (error) => Effect.succeed(jsonError(error.message, 400)),
          BotNotFoundError: (error) => Effect.succeed(jsonError(error.message, 404)),
          BotFileConflictError: (error) => Effect.succeed(jsonError(error.message, 409)),
          BotCreateIoError: (error) => Effect.succeed(jsonError(error.message, 500)),
        }),
      ),
    );

    return Layer.mergeAll(
      healthRoute,
      listBotsRoute,
      homeRoute,
      workingFoldersRoute,
      profileRoute,
      skillsRoute,
      filesRoute,
    );
  }),
);
