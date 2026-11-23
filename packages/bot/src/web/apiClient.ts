import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  BOT_LIST_ROUTE,
  BOT_HOME_ROUTE_PREFIX,
  BotEnsureHomeResponseSchema,
  BotListResponseSchema,
  type BotEnsureHomeResponse,
  type BotListResponse,
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
