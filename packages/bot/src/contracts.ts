import * as Schema from "effect/Schema";

export const BOT_API_PREFIX = "/api/bots";
export const BOT_HEALTH_ROUTE = `${BOT_API_PREFIX}/health` as const;

export const BOT_CLIENT_PREFERENCES_STORAGE_KEY = "t3codebot.clientPreferences.v1";
export const BOT_LEGACY_SIDEBAR_OPEN_STORAGE_KEY = "t3code.sidebarBotsPanelOpen";

export const BotHealthResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  module: Schema.Literal("t3codebot"),
  botsCount: Schema.Int,
});
export type BotHealthResponse = typeof BotHealthResponseSchema.Type;

export const BotClientPreferencesSchema = Schema.Struct({
  botsBarEnabled: Schema.Boolean,
  sidebarBotsPanelOpen: Schema.Boolean,
});
export type BotClientPreferences = typeof BotClientPreferencesSchema.Type;

export const DEFAULT_BOT_CLIENT_PREFERENCES: BotClientPreferences = {
  botsBarEnabled: true,
  sidebarBotsPanelOpen: false,
};
