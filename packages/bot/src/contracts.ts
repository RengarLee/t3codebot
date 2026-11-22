import * as Schema from "effect/Schema";

export const BOT_API_PREFIX = "/api/bots";
export const BOT_HEALTH_ROUTE = `${BOT_API_PREFIX}/health` as const;
export const BOT_LIST_ROUTE = `${BOT_API_PREFIX}/list` as const;
export const BOT_CREATE_ROUTE = `${BOT_API_PREFIX}/create` as const;
export const BOT_TASKS_ROUTE_PREFIX = `${BOT_API_PREFIX}/tasks` as const;

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
  sidebarBotsPanelOpen: true,
};

export const BotSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  version: Schema.String,
  sessionMode: Schema.String,
  skillsCount: Schema.Int,
  activeTasksCount: Schema.Int,
  completedTasksCount: Schema.Int,
  path: Schema.String,
  /** The T3 project this bot's sessions live in; null until it is first created. */
  projectId: Schema.NullOr(Schema.String),
});
export type BotSummary = typeof BotSummarySchema.Type;

export const BotListResponseSchema = Schema.Struct({
  directory: Schema.String,
  bots: Schema.Array(BotSummarySchema),
});
export type BotListResponse = typeof BotListResponseSchema.Type;

export const BotCreateInputSchema = Schema.Struct({
  name: Schema.String,
  summary: Schema.optional(Schema.String),
});
export type BotCreateInput = typeof BotCreateInputSchema.Type;

export const BotCreateResponseSchema = Schema.Struct({
  bot: BotSummarySchema,
});
export type BotCreateResponse = typeof BotCreateResponseSchema.Type;

export const BotTaskStatusSchema = Schema.Literals([
  "active",
  "waiting_user",
  "completed",
  "archived",
]);
export type BotTaskStatus = typeof BotTaskStatusSchema.Type;

export const BotHomeRecordSchema = Schema.Struct({
  botId: Schema.String,
  homeThreadId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type BotHomeRecord = typeof BotHomeRecordSchema.Type;

export const BotTaskRecordSchema = Schema.Struct({
  id: Schema.String,
  botId: Schema.String,
  childThreadId: Schema.NullOr(Schema.String),
  title: Schema.String,
  goal: Schema.String,
  status: BotTaskStatusSchema,
  latestDecision: Schema.NullOr(Schema.String),
  latestSummary: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
export type BotTaskRecord = typeof BotTaskRecordSchema.Type;

export const BotHomeCardKindSchema = Schema.Literals([
  "task_dispatched",
  "task_decision",
  "task_status",
]);
export type BotHomeCardKind = typeof BotHomeCardKindSchema.Type;

export const BotHomeCardRecordSchema = Schema.Struct({
  id: Schema.String,
  botId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  kind: BotHomeCardKindSchema,
  content: Schema.String,
  createdAt: Schema.String,
});
export type BotHomeCardRecord = typeof BotHomeCardRecordSchema.Type;

export const BotTasksResponseSchema = Schema.Struct({
  botId: Schema.String,
  home: Schema.NullOr(BotHomeRecordSchema),
  activeTasks: Schema.Array(BotTaskRecordSchema),
  completedTasks: Schema.Array(BotTaskRecordSchema),
  recentCards: Schema.Array(BotHomeCardRecordSchema),
});
export type BotTasksResponse = typeof BotTasksResponseSchema.Type;

export const BotBindHomeInputSchema = Schema.Struct({
  homeThreadId: Schema.NullOr(Schema.String),
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type BotBindHomeInput = typeof BotBindHomeInputSchema.Type;

/** `POST /api/bots/tasks/:botId/home`: binds (or launches) the bot's Home thread in its own project. */
export const BotEnsureHomeResponseSchema = Schema.Struct({
  home: BotHomeRecordSchema,
});
export type BotEnsureHomeResponse = typeof BotEnsureHomeResponseSchema.Type;

export const BotCreateTaskInputSchema = Schema.Struct({
  title: Schema.String,
  goal: Schema.optional(Schema.String),
  childThreadId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type BotCreateTaskInput = typeof BotCreateTaskInputSchema.Type;

export const BotUpdateTaskInputSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  goal: Schema.optional(Schema.String),
  childThreadId: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(BotTaskStatusSchema),
  latestDecision: Schema.optional(Schema.NullOr(Schema.String)),
  latestSummary: Schema.optional(Schema.String),
  emitHomeCard: Schema.optional(Schema.Boolean),
});
export type BotUpdateTaskInput = typeof BotUpdateTaskInputSchema.Type;
