import * as Schema from "effect/Schema";

export const BOT_API_PREFIX = "/api/bots";
export const BOT_HEALTH_ROUTE = `${BOT_API_PREFIX}/health` as const;
export const BOT_LIST_ROUTE = `${BOT_API_PREFIX}/list` as const;
/** `POST /api/bots/home/:botId` opens (or launches) the bot's Home thread. */
export const BOT_HOME_ROUTE_PREFIX = `${BOT_API_PREFIX}/home` as const;
/** `POST /api/bots/working-folders/:botId` replaces the bot's configured working folders. */
export const BOT_WORKING_FOLDERS_ROUTE_PREFIX = `${BOT_API_PREFIX}/working-folders` as const;
/** `POST /api/bots/profile/:botId` updates editable metadata (such as display name) for a bot. */
export const BOT_PROFILE_ROUTE_PREFIX = `${BOT_API_PREFIX}/profile` as const;

export const BOT_WORKING_FOLDERS_MAX = 128;

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

/** Marker on T3 `notification` wakes sent by the bot server so Home hides the wake row. */
export const BOT_WAKE_NOTIFICATION_DETAIL = "bot:wake" as const;

export function isHiddenBotWakeNotification(
  item:
    | { readonly type?: string | undefined; readonly detail?: string | undefined }
    | null
    | undefined,
): boolean {
  return item?.type === "notification" && item.detail === BOT_WAKE_NOTIFICATION_DETAIL;
}

export const BotRoleSchema = Schema.Literals(["main", "sub"]);
export type BotRole = typeof BotRoleSchema.Type;

export const BotSummarySchema = Schema.Struct({
  id: Schema.String,
  role: BotRoleSchema,
  name: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  /** Kinds of work this bot owns and refuses; Bot routes by them. */
  inScope: Schema.Array(Schema.String),
  outOfScope: Schema.Array(Schema.String),
  /** Extra local folders this bot may read and work in directly, besides its own workspace. */
  workingFolders: Schema.Array(Schema.String),
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

export const BotUpdateWorkingFoldersRequestSchema = Schema.Struct({
  workingFolders: Schema.Array(Schema.String),
});
export type BotUpdateWorkingFoldersRequest = typeof BotUpdateWorkingFoldersRequestSchema.Type;

export const BotUpdateWorkingFoldersResponseSchema = Schema.Struct({
  bot: BotSummarySchema,
});
export type BotUpdateWorkingFoldersResponse = typeof BotUpdateWorkingFoldersResponseSchema.Type;

export const BotUpdateProfileRequestSchema = Schema.Struct({
  name: Schema.String,
});
export type BotUpdateProfileRequest = typeof BotUpdateProfileRequestSchema.Type;

export const BotUpdateProfileResponseSchema = Schema.Struct({
  bot: BotSummarySchema,
});
export type BotUpdateProfileResponse = typeof BotUpdateProfileResponseSchema.Type;

/** What every Bot session must hand back. T3 enforces it as the launch's `outputSchema`. */
export const BotSessionReceiptSchema = Schema.Struct({
  status: Schema.Literals(["done", "blocked", "needs_decision", "waiting_user"]),
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
    status: { type: "string", enum: ["done", "blocked", "needs_decision", "waiting_user"] },
    outcome: {
      type: "string",
      description:
        "Concise 1-2 sentence takeaway (under 200 chars): what happened or what is needed. Keep full details in the session thread or files.",
    },
    artifacts: {
      type: "array",
      items: { type: "string" },
      description: "Paths or links to what the session produced. Empty when none.",
    },
  },
} as const;

/** What a "Create sub-bot" session hands back; the bot server builds the sub-bot from it. */
export const BotSubBotSpecSchema = Schema.Struct({
  name: Schema.String,
  summary: Schema.String,
  inScope: Schema.Array(Schema.String),
  outOfScope: Schema.Array(Schema.String),
  persona: Schema.String,
  projects: Schema.Array(Schema.String),
});
export type BotSubBotSpec = typeof BotSubBotSpecSchema.Type;

/** `BotSubBotSpecSchema` as the JSON Schema Home passes to `t3_thread_launch`. */
export const BOT_SUB_BOT_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "inScope", "outOfScope", "persona", "projects"],
  properties: {
    name: { type: "string", description: "Short display name, unique among sub-bots." },
    summary: { type: "string", description: "One sentence: what this sub-bot is for." },
    inScope: {
      type: "array",
      items: { type: "string" },
      description: "3-5 kinds of work it owns, split by workflow, not by topic.",
    },
    outOfScope: {
      type: "array",
      items: { type: "string" },
      description: "Work it must not take, and where that work goes instead.",
    },
    persona: { type: "string", description: "Two or three sentences: who it is and how it works." },
    projects: {
      type: "array",
      items: { type: "string" },
      description:
        "Absolute folder paths of the projects it may hand code work to. Empty when it does no code work.",
    },
  },
} as const;
