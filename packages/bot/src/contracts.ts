import * as Schema from "effect/Schema";

export const BOT_API_PREFIX = "/api/bots";
export const BOT_HEALTH_ROUTE = `${BOT_API_PREFIX}/health` as const;
export const BOT_LIST_ROUTE = `${BOT_API_PREFIX}/list` as const;
/** `POST /api/bots/home/:botId` opens (or launches) the bot's Home thread. */
export const BOT_HOME_ROUTE_PREFIX = `${BOT_API_PREFIX}/home` as const;

export const BOT_CLIENT_PREFERENCES_STORAGE_KEY = "t3codebot.clientPreferences.v1";

export const BotHealthResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  module: Schema.Literal("t3codebot"),
  botsCount: Schema.Int,
});
export type BotHealthResponse = typeof BotHealthResponseSchema.Type;

export const BotClientPreferencesSchema = Schema.Struct({
  botsBarEnabled: Schema.Boolean,
});
export type BotClientPreferences = typeof BotClientPreferencesSchema.Type;

export const DEFAULT_BOT_CLIENT_PREFERENCES: BotClientPreferences = {
  botsBarEnabled: true,
};

/** The one bot the user talks to; every other bot is a background sub-bot. */
export const MAIN_BOT_ID = "main";

export const BotRoleSchema = Schema.Literals(["main", "sub"]);
export type BotRole = typeof BotRoleSchema.Type;

export const BotSummarySchema = Schema.Struct({
  id: Schema.String,
  role: BotRoleSchema,
  name: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  version: Schema.String,
  sessionMode: Schema.String,
  skillsCount: Schema.Int,
  path: Schema.String,
  /** The T3 project this bot's sessions live in; null until it is first created. */
  projectId: Schema.NullOr(Schema.String),
  /** The bot's Home thread in that project; null until Home is first opened. */
  homeThreadId: Schema.NullOr(Schema.String),
});
export type BotSummary = typeof BotSummarySchema.Type;

export const BotListResponseSchema = Schema.Struct({
  directory: Schema.String,
  bots: Schema.Array(BotSummarySchema),
});
export type BotListResponse = typeof BotListResponseSchema.Type;

export const BotHomeRecordSchema = Schema.Struct({
  botId: Schema.String,
  homeThreadId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type BotHomeRecord = typeof BotHomeRecordSchema.Type;

export const BotEnsureHomeResponseSchema = Schema.Struct({
  home: BotHomeRecordSchema,
});
export type BotEnsureHomeResponse = typeof BotEnsureHomeResponseSchema.Type;

/** What every Bot session must hand back. T3 enforces it as the launch's `outputSchema`. */
export const BotSessionReceiptSchema = Schema.Struct({
  status: Schema.Literals(["done", "blocked", "needs_decision"]),
  outcome: Schema.String,
  artifacts: Schema.Array(Schema.String),
});
export type BotSessionReceipt = typeof BotSessionReceiptSchema.Type;

/** `BotSessionReceiptSchema` as the JSON Schema Home passes to `t3_thread_launch`. */
export const BOT_SESSION_RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "outcome", "artifacts"],
  properties: {
    status: { type: "string", enum: ["done", "blocked", "needs_decision"] },
    outcome: { type: "string", description: "One sentence: what happened or what is needed." },
    artifacts: {
      type: "array",
      items: { type: "string" },
      description: "Paths or links to what the session produced. Empty when none.",
    },
  },
} as const;
