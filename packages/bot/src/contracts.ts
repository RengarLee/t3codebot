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

/** `POST /api/bots/skills/<command>` carries every skill command; see `BOT_SKILL_COMMANDS`. */
export const BOT_SKILLS_ROUTE_PREFIX = `${BOT_API_PREFIX}/skills` as const;

/** Directory under `<stateDir>/bots/` whose `skills/` every bot reads. Not a bot (the `_` prefix hides it). */
export const BOT_SHARED_DIR_NAME = "_shared";

/** A skill's folder name: `skills/<name>/SKILL.md`. Unique across the shared folder and a bot's own. */
export const SKILL_NAME_MAX_LENGTH = 64;
export const SkillNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(SKILL_NAME_MAX_LENGTH),
);

/** The built-in skill every bot gets through the shared folder. */
export const BUILTIN_SKILL_NAMES = ["skill-improver"] as const;

/**
 * Where a skill lives. `shared` skills are read by every bot, so one edit reaches all of them;
 * `bot` skills belong to one bot.
 */
export const SkillScopeSchema = Schema.Union([
  Schema.Struct({ scope: Schema.Literal("shared") }),
  Schema.Struct({ scope: Schema.Literal("bot"), botId: Schema.String }),
]);
export type SkillScope = typeof SkillScopeSchema.Type;

/** The key a scope has in the store: `shared` or `bot:<id>`. */
export function skillScopeKey(scope: SkillScope): string {
  return scope.scope === "shared" ? "shared" : `bot:${scope.botId}`;
}

/**
 * Why a revision exists. Nothing changes a skill without the user's say-so, so there is no
 * automatic trigger. `external` is the safety net for a change nobody explained (the user's own
 * editor, or an agent that skipped the rules). `builtin` is the shipped skill being installed.
 */
export const SkillTriggerSchema = Schema.Literals([
  "builtin",
  "user_manual",
  "user_request",
  "suggested",
  "external",
]);
export type SkillTrigger = typeof SkillTriggerSchema.Type;

export const SkillRevisionSummarySchema = Schema.Struct({
  revision: Schema.Int,
  parentRevision: Schema.NullOr(Schema.Int),
  trigger: SkillTriggerSchema,
  /** One sentence on why it changed. Empty when nobody said. */
  reason: Schema.String,
  /** The thread whose run ended with this change, when an agent made it. */
  threadId: Schema.NullOr(Schema.String),
  /** The bot whose agent made the change; null for the user's own edits. */
  botId: Schema.NullOr(Schema.String),
  /** The suggestion the user accepted, for `suggested`. */
  suggestionId: Schema.NullOr(Schema.String),
  /** The skill was deleted at this revision; its content is null. */
  deleted: Schema.Boolean,
  createdAt: Schema.String,
});
export type SkillRevisionSummary = typeof SkillRevisionSummarySchema.Type;

/** A revision with its `SKILL.md`; null content means the skill was deleted at this revision. */
export const SkillRevisionSchema = Schema.Struct({
  ...SkillRevisionSummarySchema.fields,
  content: Schema.NullOr(Schema.String),
});
export type SkillRevision = typeof SkillRevisionSchema.Type;

export const SkillSummarySchema = Schema.Struct({
  scope: SkillScopeSchema,
  name: SkillNameSchema,
  /** From the `description` in `SKILL.md`'s front matter; empty when there is none. */
  description: Schema.String,
  /** The latest revision. */
  revision: Schema.Int,
  updatedAt: Schema.String,
  /** Deleted skills stay listed so the user can restore them. */
  deleted: Schema.Boolean,
  builtin: Schema.Boolean,
});
export type SkillSummary = typeof SkillSummarySchema.Type;

export const SkillListRequestSchema = Schema.Struct({ scope: SkillScopeSchema });
export const SkillListResponseSchema = Schema.Struct({ skills: Schema.Array(SkillSummarySchema) });

export const SkillRefSchema = Schema.Struct({ scope: SkillScopeSchema, name: SkillNameSchema });
export type SkillRef = typeof SkillRefSchema.Type;

/** Newest first. */
export const SkillHistoryResponseSchema = Schema.Struct({
  revisions: Schema.Array(SkillRevisionSummarySchema),
});

export const SkillRevisionRequestSchema = Schema.Struct({
  ...SkillRefSchema.fields,
  revision: Schema.Int,
});
export const SkillRevisionResponseSchema = Schema.Struct({ revision: SkillRevisionSchema });

/**
 * The user's own save. `expectedRevision` is the latest revision the editor saw (null to create), so
 * a change that landed in between is a conflict, not an overwrite.
 */
export const SkillSaveRequestSchema = Schema.Struct({
  ...SkillRefSchema.fields,
  content: Schema.String,
  reason: Schema.String,
  expectedRevision: Schema.NullOr(Schema.Int),
});
export const SkillDeleteRequestSchema = Schema.Struct({
  ...SkillRefSchema.fields,
  reason: Schema.String,
  expectedRevision: Schema.Int,
});
/** Restoring copies an older revision's content into a new revision; history only grows. */
export const SkillRestoreRequestSchema = Schema.Struct({
  ...SkillRefSchema.fields,
  revision: Schema.Int,
  expectedRevision: Schema.Int,
});
export const SkillWriteResponseSchema = Schema.Struct({ revision: SkillRevisionSummarySchema });

export const SkillSuggestionSignalSchema = Schema.Literals([
  "correction",
  "technique",
  "outdated_skill",
]);
export const SkillSuggestionStatusSchema = Schema.Literals(["pending", "accepted", "dismissed"]);

/** An agent's proposal to create or change a skill. It changes nothing until the user accepts. */
export const SkillSuggestionSchema = Schema.Struct({
  id: Schema.String,
  scope: SkillScopeSchema,
  /** The skill to change, or the name proposed for a new one. */
  name: SkillNameSchema,
  action: Schema.Literals(["create", "update"]),
  signal: SkillSuggestionSignalSchema,
  /** The lesson, in one to three sentences. */
  message: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  botId: Schema.String,
  status: SkillSuggestionStatusSchema,
  createdAt: Schema.String,
  decidedAt: Schema.NullOr(Schema.String),
});
export type SkillSuggestion = typeof SkillSuggestionSchema.Type;

export const SkillSuggestionsResponseSchema = Schema.Struct({
  suggestions: Schema.Array(SkillSuggestionSchema),
});
export const SkillSuggestionDecisionRequestSchema = Schema.Struct({ id: Schema.String });
export const SkillSuggestionDecisionResponseSchema = Schema.Struct({
  suggestion: SkillSuggestionSchema,
});

/**
 * What an agent drops in `<skills root>/.inbox/<uuid>.json`, one file per entry so concurrent
 * agents never write the same file. The server reads and deletes entries when a run ends.
 * A `change` entry is written BEFORE the edit it explains.
 */
export const SkillInboxEntrySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("change"),
    name: SkillNameSchema,
    basis: Schema.Literals(["user_request", "suggested"]),
    reason: Schema.String,
    botId: Schema.String,
    suggestionId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("suggest"),
    name: SkillNameSchema,
    action: Schema.Literals(["create", "update"]),
    signal: SkillSuggestionSignalSchema,
    message: Schema.String,
    botId: Schema.String,
  }),
]);
export type SkillInboxEntry = typeof SkillInboxEntrySchema.Type;

/** The one place the skill command names live; routes and the web client both read it. */
export const BOT_SKILL_COMMANDS = {
  list: "list",
  history: "history",
  revision: "revision",
  save: "save",
  delete: "delete",
  restore: "restore",
  suggestions: "suggestions",
  acceptSuggestion: "suggestions/accept",
  dismissSuggestion: "suggestions/dismiss",
} as const;
export type BotSkillCommand = keyof typeof BOT_SKILL_COMMANDS;
