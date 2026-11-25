import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  BOT_LIST_ROUTE,
  BOT_HOME_ROUTE_PREFIX,
  BOT_PROFILE_ROUTE_PREFIX,
  BOT_SKILL_COMMANDS,
  BOT_SKILLS_ROUTE_PREFIX,
  BOT_WORKING_FOLDERS_ROUTE_PREFIX,
  BotEnsureHomeResponseSchema,
  BotListResponseSchema,
  BotUpdateProfileResponseSchema,
  BotUpdateWorkingFoldersResponseSchema,
  SkillDeleteRequestSchema,
  SkillHistoryResponseSchema,
  SkillListResponseSchema,
  SkillRestoreRequestSchema,
  SkillRevisionResponseSchema,
  SkillSaveRequestSchema,
  SkillSuggestionDecisionResponseSchema,
  SkillSuggestionsResponseSchema,
  SkillWriteResponseSchema,
  type BotSkillCommand,
  type BotEnsureHomeResponse,
  type BotListResponse,
  type BotUpdateProfileRequest,
  type BotUpdateProfileResponse,
  type BotUpdateWorkingFoldersResponse,
  type SkillRef,
  type SkillScope,
} from "../contracts.ts";

export interface BotApiClientOptions {
  readonly httpBaseUrl?: string | null | undefined;
}

const BOT_STATE_CHANGED_EVENT = "t3codebot:server_state_changed";
const localListeners = new Set<() => void>();

export function notifyBotsServerStateChanged(): void {
  for (const listener of localListeners) {
    listener();
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(BOT_STATE_CHANGED_EVENT));
    } catch {
      // Ignore synthetic environments without Event dispatch support.
    }
  }
}

export function subscribeBotsServerStateChanged(listener: () => void): () => void {
  localListeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      localListeners.delete(listener);
    };
  }
  window.addEventListener(BOT_STATE_CHANGED_EVENT, listener);
  return () => {
    localListeners.delete(listener);
    window.removeEventListener(BOT_STATE_CHANGED_EVENT, listener);
  };
}

function buildBotUrl(route: string, httpBaseUrl?: string | null): string {
  const base = httpBaseUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}${route}` : route;
}

export function fetchBotList(options?: BotApiClientOptions): Promise<BotListResponse> {
  return Effect.runPromise(
    HttpClient.get(buildBotUrl(BOT_LIST_ROUTE, options?.httpBaseUrl)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(BotListResponseSchema)),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
}

/** Binds the bot's Home thread, launching one in the bot's project when none is live. */
export function ensureBotHome(
  botId: string,
  options?: BotApiClientOptions,
): Promise<BotEnsureHomeResponse> {
  const route = `${BOT_HOME_ROUTE_PREFIX}/${encodeURIComponent(botId)}`;
  return Effect.runPromise(
    HttpClient.execute(HttpClientRequest.post(buildBotUrl(route, options?.httpBaseUrl))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(BotEnsureHomeResponseSchema)),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
}

export class BotApiRequestError extends Schema.TaggedError<
  BotApiRequestError,
  { readonly brand: unique symbol }
>()("BotApiRequestError", {
  status: Schema.Int,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Replaces a bot's allowed working folders and refreshes all subscribed bot views. */
export async function updateBotWorkingFolders(
  botId: string,
  workingFolders: ReadonlyArray<string>,
  options?: BotApiClientOptions,
): Promise<BotUpdateWorkingFoldersResponse> {
  const route = `${BOT_WORKING_FOLDERS_ROUTE_PREFIX}/${encodeURIComponent(botId)}`;
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(buildBotUrl(route, options?.httpBaseUrl)).pipe(
        HttpClientRequest.bodyJson({ workingFolders }),
      );
      const response = yield* HttpClient.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* HttpClientResponse.schemaBodyJson(BotUpdateWorkingFoldersResponseSchema)(
          response,
        );
      }
      const payload = yield* response.json.pipe(Effect.orElseSucceed(() => null));
      const detail =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
          ? payload.error
          : `Request failed with status ${response.status}.`;
      return yield* new BotApiRequestError({ status: response.status, detail });
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  notifyBotsServerStateChanged();
  return result;
}

/** Updates a bot's editable profile fields (such as display name) and refreshes subscribed bot views. */
export async function updateBotProfile(
  botId: string,
  input: BotUpdateProfileRequest,
  options?: BotApiClientOptions,
): Promise<BotUpdateProfileResponse> {
  const route = `${BOT_PROFILE_ROUTE_PREFIX}/${encodeURIComponent(botId)}`;
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(buildBotUrl(route, options?.httpBaseUrl)).pipe(
        HttpClientRequest.bodyJson(input),
      );
      const response = yield* HttpClient.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* HttpClientResponse.schemaBodyJson(BotUpdateProfileResponseSchema)(response);
      }
      const payload = yield* response.json.pipe(Effect.orElseSucceed(() => null));
      const detail =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
          ? payload.error
          : `Request failed with status ${response.status}.`;
      return yield* new BotApiRequestError({ status: response.status, detail });
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  notifyBotsServerStateChanged();
  return result;
}

async function postSkillCommand<A>(
  command: BotSkillCommand,
  body: unknown,
  schema: Schema.Decoder<A>,
  options?: BotApiClientOptions,
): Promise<A> {
  const route = `${BOT_SKILLS_ROUTE_PREFIX}/${BOT_SKILL_COMMANDS[command]}`;
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(buildBotUrl(route, options?.httpBaseUrl)).pipe(
        HttpClientRequest.bodyJson(body),
      );
      const response = yield* HttpClient.execute(request);
      if (response.status >= 200 && response.status < 300) {
        const value = yield* HttpClientResponse.schemaBodyJson(schema)(response);
        return { ok: true as const, value };
      }
      const payload = yield* response.json.pipe(Effect.orElseSucceed(() => null));
      const detail =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
          ? payload.error
          : `Request failed with status ${response.status}.`;
      return { ok: false as const, status: response.status, detail };
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  if (!outcome.ok) throw new BotApiRequestError({ status: outcome.status, detail: outcome.detail });
  return outcome.value;
}

export type SkillSaveInput = typeof SkillSaveRequestSchema.Type;
export type SkillDeleteInput = typeof SkillDeleteRequestSchema.Type;
export type SkillRestoreInput = typeof SkillRestoreRequestSchema.Type;

export function listSkills(scope: SkillScope, options?: BotApiClientOptions) {
  return postSkillCommand("list", { scope }, SkillListResponseSchema, options);
}

export function fetchSkillHistory(ref: SkillRef, options?: BotApiClientOptions) {
  return postSkillCommand("history", ref, SkillHistoryResponseSchema, options);
}

export function fetchSkillRevision(ref: SkillRef, revision: number, options?: BotApiClientOptions) {
  return postSkillCommand("revision", { ...ref, revision }, SkillRevisionResponseSchema, options);
}

export function saveSkill(input: SkillSaveInput, options?: BotApiClientOptions) {
  return postSkillCommand("save", input, SkillWriteResponseSchema, options);
}

export function deleteSkill(input: SkillDeleteInput, options?: BotApiClientOptions) {
  return postSkillCommand("delete", input, SkillWriteResponseSchema, options);
}

export function restoreSkill(input: SkillRestoreInput, options?: BotApiClientOptions) {
  return postSkillCommand("restore", input, SkillWriteResponseSchema, options);
}

/** Pending suggestions across every scope. */
export function listSkillSuggestions(options?: BotApiClientOptions) {
  return postSkillCommand("suggestions", {}, SkillSuggestionsResponseSchema, options);
}

/** Asks the suggesting bot to apply it. The suggestion stays pending until the bot's edit lands. */
export function acceptSkillSuggestion(id: string, options?: BotApiClientOptions) {
  return postSkillCommand(
    "acceptSuggestion",
    { id },
    SkillSuggestionDecisionResponseSchema,
    options,
  );
}

export function dismissSkillSuggestion(id: string, options?: BotApiClientOptions) {
  return postSkillCommand(
    "dismissSuggestion",
    { id },
    SkillSuggestionDecisionResponseSchema,
    options,
  );
}
