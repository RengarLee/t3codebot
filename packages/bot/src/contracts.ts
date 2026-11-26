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

/** T3 projects track at most 128 folders; two are reserved for the bot's skills folders. */
export const BOT_WORKING_FOLDERS_MAX = 126;

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

/** Omitted fields stay as they are. */
export const BotUpdateProfileRequestSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  /** One sentence on what the bot is for; Bot routes work to sub-bots by it. */
  summary: Schema.optional(Schema.String),
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
  workingFolders: Schema.optional(Schema.Array(Schema.String)),
});
export type BotSubBotSpec = typeof BotSubBotSpecSchema.Type;

/** `BotSubBotSpecSchema` as the JSON Schema Home passes to `t3_thread_launch`. */
export const BOT_SUB_BOT_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "inScope", "outOfScope", "persona", "projects", "workingFolders"],
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
    workingFolders: {
      type: "array",
      items: { type: "string" },
      description:
        "Absolute local folder paths the user explicitly approved this sub-bot to read and work in directly. Empty when none were requested.",
    },
  },
} as const;

/** What an "Update working folders" session hands back; the bot server validates and applies it. */
export const BotWorkingFoldersUpdateSchema = Schema.Struct({
  botId: Schema.String,
  add: Schema.Array(Schema.String),
  remove: Schema.Array(Schema.String),
});
export type BotWorkingFoldersUpdate = typeof BotWorkingFoldersUpdateSchema.Type;

/** `BotWorkingFoldersUpdateSchema` as the JSON Schema Home passes to `t3_thread_launch`. */
export const BOT_WORKING_FOLDERS_UPDATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["botId", "add", "remove"],
  properties: {
    botId: {
      type: "string",
      description: 'Target bot id ("main" for Bot itself, or the sub-bot botId from the roster).',
    },
    add: {
      type: "array",
      items: { type: "string" },
      description:
        "Absolute local folder paths to grant this bot access to. Empty when only removing.",
    },
    remove: {
      type: "array",
      items: { type: "string" },
      description:
        "Configured working folder paths to revoke from this bot. Empty when only adding.",
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

/** Title prefix of the throwaway thread a background review runs in; event sync ignores these threads. */
export const SKILL_REVIEW_TITLE_PREFIX = "Skill review: ";

/**
 * What a background review hands back: at most one suggestion, or null. Only the reviewed bot's own
 * skills take part. The `_shared` skills are never reviewed, listed or suggested, so there is no scope.
 */
export const SkillReviewResultSchema = Schema.Struct({
  skill: Schema.NullOr(
    Schema.Struct({
      action: Schema.Literals(["create", "update"]),
      name: SkillNameSchema,
      signal: SkillSuggestionSignalSchema,
      message: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(600)),
    }),
  ),
});
export type SkillReviewResult = typeof SkillReviewResultSchema.Type;

/** `SkillReviewResultSchema` as the JSON Schema the review thread's message passes as `outputSchema`. */
export const SKILL_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skill"],
  properties: {
    skill: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["action", "name", "signal", "message"],
      properties: {
        action: { type: "string", enum: ["create", "update"] },
        name: {
          type: "string",
          description: "Folder name of the skill: lowercase words joined by hyphens.",
        },
        signal: { type: "string", enum: ["correction", "technique", "outdated_skill"] },
        message: {
          type: "string",
          description:
            "The lesson in one to three sentences, in the language of the user's messages.",
        },
      },
    },
  },
} as const;

/** The user's switch for background review. It only ever proposes; the user still accepts. */
export const SkillReviewSettingsSchema = Schema.Struct({ enabled: Schema.Boolean });
export type SkillReviewSettings = typeof SkillReviewSettingsSchema.Type;
export const DEFAULT_SKILL_REVIEW_SETTINGS: SkillReviewSettings = { enabled: true };

export const SkillReviewSettingsResponseSchema = Schema.Struct({
  settings: SkillReviewSettingsSchema,
});

/** Reviews the bot's chats that have runs nobody reviewed yet. `queued` is how many it started. */
export const SkillReviewNowRequestSchema = Schema.Struct({ botId: Schema.String });
export const SkillReviewNowResponseSchema = Schema.Struct({ queued: Schema.Int });

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
  reviewSettings: "review/settings",
  setReviewSettings: "review/settings/set",
  reviewNow: "review/now",
} as const;
export type BotSkillCommand = keyof typeof BOT_SKILL_COMMANDS;

/** `POST /api/bots/files/<command>` reads and edits a bot's persona and memory files. */
export const BOT_FILES_ROUTE_PREFIX = `${BOT_API_PREFIX}/files` as const;

export const BOT_FILE_COMMANDS = {
  list: "list",
  read: "read",
  save: "save",
} as const;
export type BotFileCommand = keyof typeof BOT_FILE_COMMANDS;

export const BOT_PERSONA_FILE = "SOUL.md";
export const BOT_LESSONS_FILE = "LESSONS.md";
export const BOT_LONG_TERM_MEMORY_FILE = "memory/long-term.md";
export const BOT_DAILY_MEMORY_DIR = "memory/daily";

/** The only files in a bot's folder these commands touch, by path relative to that folder. */
export const BotFilePathSchema = Schema.String.check(
  Schema.isPattern(
    /^(?:SOUL\.md|LESSONS\.md|memory\/long-term\.md|memory\/daily\/\d{4}-\d{2}-\d{2}\.md)$/,
  ),
);
export type BotFilePath = typeof BotFilePathSchema.Type;

export const BotFileListRequestSchema = Schema.Struct({ botId: Schema.String });
/** Daily notes are listed by path, newest first; the fixed files are always editable. */
export const BotFileListResponseSchema = Schema.Struct({
  daily: Schema.Array(BotFilePathSchema),
});
export type BotFileListResponse = typeof BotFileListResponseSchema.Type;

export const BotFileReadRequestSchema = Schema.Struct({
  botId: Schema.String,
  path: BotFilePathSchema,
});

/** `version` is the content's hash, or `null` while the file does not exist yet. */
export const BotFileSchema = Schema.Struct({
  path: BotFilePathSchema,
  content: Schema.String,
  version: Schema.NullOr(Schema.String),
});
export type BotFile = typeof BotFileSchema.Type;
export const BotFileResponseSchema = Schema.Struct({ file: BotFileSchema });

/** Refused with 409 when the file changed since `expectedVersion` (the bot writes these too). */
export const BotFileSaveRequestSchema = Schema.Struct({
  botId: Schema.String,
  path: BotFilePathSchema,
  content: Schema.String,
  expectedVersion: Schema.NullOr(Schema.String),
});
export type BotFileSaveRequest = typeof BotFileSaveRequestSchema.Type;
