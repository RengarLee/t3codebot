import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  BOT_SKILL_COMMANDS,
  BUILTIN_SKILL_NAMES,
  SkillDeleteRequestSchema,
  SkillListRequestSchema,
  SkillRefSchema,
  SkillReviewNowRequestSchema,
  SkillReviewSettingsSchema,
  SkillRestoreRequestSchema,
  SkillRevisionRequestSchema,
  SkillSaveRequestSchema,
  SkillSuggestionDecisionRequestSchema,
  skillScopeKey,
  type SkillRevisionSummary,
  type SkillScope,
  type SkillSuggestion,
} from "../contracts.ts";
import { BUILTIN_SKILL_FILES } from "./builtinSkills.ts";
import type {
  BotStoreError,
  SkillRevisionHeader,
  SkillRevisionRecord,
  SkillSuggestionRecord,
} from "./db.ts";
import type { BotNotFoundError } from "./home.ts";
import type { BotHostError, BotHostOrchestrationShape } from "./host.ts";
import { BotCreateIoError } from "./registry.ts";
import {
  hashSkillContent,
  listAllSkillScopes,
  reconcileScope,
  reconcileScopes,
  reconcileLocked,
  SKILL_MAX_CHARS,
  withScopeLock,
  type SkillDeps,
} from "./skillReconciler.ts";
import { isSafeBotId, parseSkillScopeKey, sharedSkillsRoot, skillScopeRoot } from "./skillRoots.ts";
import type { SkillReviewService } from "./skillReview.ts";
import { resolveBotStoragePaths } from "./storage.ts";

export class SkillValidationError extends Schema.TaggedError<
  SkillValidationError,
  { readonly brand: unique symbol }
>()("SkillValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export class SkillNotFoundError extends Schema.TaggedError<
  SkillNotFoundError,
  { readonly brand: unique symbol }
>()("SkillNotFoundError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** The skill changed since the editor loaded it. */
export class SkillConflictError extends Schema.TaggedError<
  SkillConflictError,
  { readonly brand: unique symbol }
>()("SkillConflictError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export class SkillUnavailableError extends Schema.TaggedError<
  SkillUnavailableError,
  { readonly brand: unique symbol }
>()("SkillUnavailableError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface SkillCommandDeps extends SkillDeps {
  readonly orchestration?: BotHostOrchestrationShape | undefined;
  /** The background review. Absent without orchestration, which it needs to launch review threads. */
  readonly skillReview?: SkillReviewService | undefined;
  /** The bot's Home thread, launched when it has none yet. Needed to accept a suggestion. */
  readonly ensureHome?:
    | ((
        botId: string,
      ) => Effect.Effect<
        { readonly homeThreadId: string | null },
        BotNotFoundError | BotHostError | BotStoreError,
        FileSystem.FileSystem | Path.Path
      >)
    | undefined;
}

const REASON_MAX_CHARS = 500;

function cleanReason(reason: string, fallback: string): string {
  return reason.trim().slice(0, REASON_MAX_CHARS) || fallback;
}

function summarize(record: SkillRevisionRecord | SkillRevisionHeader): SkillRevisionSummary {
  return {
    revision: record.revision,
    parentRevision: record.parentRevision,
    trigger: record.trigger,
    reason: record.reason,
    threadId: record.threadId,
    botId: record.botId,
    suggestionId: record.suggestionId,
    deleted: "deleted" in record ? record.deleted : record.content === null,
    createdAt: record.createdAt,
  };
}

function toWireSuggestion(record: SkillSuggestionRecord): SkillSuggestion {
  return {
    id: record.id,
    scope: parseSkillScopeKey(record.scopeKey),
    name: record.skill,
    action: record.action,
    signal: record.signal,
    message: record.message,
    threadId: record.threadId,
    botId: record.botId,
    status: record.status,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
  };
}

/** The `description` in a SKILL.md front matter block; empty when there is none. */
export function parseSkillDescription(content: string): string {
  const text = content.replaceAll(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (!text.startsWith("---\n")) return "";
  const end = text.indexOf("\n---", 3);
  if (end < 0) return "";
  const lines = text.slice(4, end).split("\n");
  const index = lines.findIndex((line) => /^description\s*:/.test(line));
  if (index < 0) return "";
  let value = (lines[index] ?? "").replace(/^description\s*:\s*/, "").trim();
  if (value === "" || /^[>|][+-]?$/.test(value)) {
    const folded: Array<string> = [];
    for (const line of lines.slice(index + 1)) {
      if (!/^\s+\S/.test(line)) break;
      folded.push(line.trim());
    }
    value = folded.join(" ");
  }
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value.slice(0, 500);
}

const decodeListRequest = Schema.decodeUnknownEffect(SkillListRequestSchema);
const decodeRefRequest = Schema.decodeUnknownEffect(SkillRefSchema);
const decodeRevisionRequest = Schema.decodeUnknownEffect(SkillRevisionRequestSchema);
const decodeSaveRequest = Schema.decodeUnknownEffect(SkillSaveRequestSchema);
const decodeDeleteRequest = Schema.decodeUnknownEffect(SkillDeleteRequestSchema);
const decodeRestoreRequest = Schema.decodeUnknownEffect(SkillRestoreRequestSchema);
const decodeDecisionRequest = Schema.decodeUnknownEffect(SkillSuggestionDecisionRequestSchema);
const decodeReviewSettings = Schema.decodeUnknownEffect(SkillReviewSettingsSchema);
const decodeReviewNowRequest = Schema.decodeUnknownEffect(SkillReviewNowRequestSchema);

const asBadBody = Effect.mapError(
  () => new SkillValidationError({ detail: "The request body is not valid for this command." }),
);

const assertScopeExists = Effect.fn("bot.skills.assertScopeExists")(function* (
  deps: SkillDeps,
  scope: SkillScope,
) {
  if (scope.scope === "shared") return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const yaml = isSafeBotId(scope.botId)
    ? yield* fs.stat(path.join(directory, scope.botId, "bot.yaml")).pipe(Effect.option)
    : null;
  if (yaml === null || yaml._tag === "None" || yaml.value.type !== "File") {
    return yield* new SkillNotFoundError({ detail: `Bot not found: ${scope.botId}` });
  }
});

/** A skill name is one skill to a bot: its own folder and the shared one must not both hold it. */
const assertNameFree = Effect.fn("bot.skills.assertNameFree")(function* (
  deps: SkillDeps,
  scope: SkillScope,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const holds = (root: string) =>
    fs.stat(path.join(root, name, "SKILL.md")).pipe(
      Effect.option,
      Effect.map((info) => info._tag === "Some" && info.value.type === "File"),
    );
  if (scope.scope === "bot") {
    if (yield* holds(sharedSkillsRoot(path, directory))) {
      return yield* new SkillValidationError({
        detail: `A shared skill named "${name}" already exists. Pick another name, or edit the shared one.`,
      });
    }
    return;
  }
  for (const other of yield* listAllSkillScopes(deps.stateDir)) {
    if (other.scope === "shared") continue;
    const root = skillScopeRoot(path, directory, other);
    if (root !== null && (yield* holds(root))) {
      return yield* new SkillValidationError({
        detail: `Bot "${other.botId}" already has its own skill named "${name}". Pick another name.`,
      });
    }
  }
});

const writeSkillFile = Effect.fn("bot.skills.writeFile")(function* (
  deps: SkillDeps,
  scope: SkillScope,
  name: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const root = skillScopeRoot(path, directory, scope);
  if (root === null) return yield* new SkillNotFoundError({ detail: "Unknown skill scope." });
  const file = path.join(root, name, "SKILL.md");
  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
    Effect.flatMap(() => fs.writeFileString(file, content)),
    Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })),
  );
});

const removeSkillFile = Effect.fn("bot.skills.removeFile")(function* (
  deps: SkillDeps,
  scope: SkillScope,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const root = skillScopeRoot(path, directory, scope);
  if (root === null) return;
  const folder = path.join(root, name);
  yield* fs
    .remove(path.join(folder, "SKILL.md"), { force: true })
    .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
  const rest = yield* fs.readDirectory(folder).pipe(Effect.option);
  if (rest._tag === "Some" && rest.value.length === 0) {
    yield* fs.remove(folder, { recursive: true, force: true }).pipe(Effect.ignore);
  }
});

const conflictDetail = (latest: SkillRevisionRecord | null) =>
  latest === null
    ? "This skill no longer exists. Reload and try again."
    : `This skill changed in the meantime (now at revision ${latest.revision}). Reload and try again.`;

function checkContent(content: string) {
  if (content.trim().length === 0) {
    return new SkillValidationError({ detail: "SKILL.md cannot be empty." });
  }
  if (content.length > SKILL_MAX_CHARS) {
    return new SkillValidationError({
      detail: `SKILL.md can be at most ${SKILL_MAX_CHARS} characters.`,
    });
  }
  return null;
}

export const listSkills = Effect.fn("bot.skills.list")(function* (
  deps: SkillDeps,
  scope: SkillScope,
) {
  yield* assertScopeExists(deps, scope);
  yield* reconcileScope(deps, scope, { threadId: null });
  const records = yield* deps.store.listLatestSkillRevisions(skillScopeKey(scope));
  return {
    skills: records.map((record) => ({
      scope,
      name: record.skill,
      description: record.content === null ? "" : parseSkillDescription(record.content),
      revision: record.revision,
      updatedAt: record.createdAt,
      deleted: record.content === null,
      builtin:
        scope.scope === "shared" &&
        (BUILTIN_SKILL_NAMES as ReadonlyArray<string>).includes(record.skill),
    })),
  };
});

export const skillHistory = Effect.fn("bot.skills.history")(function* (
  deps: SkillDeps,
  ref: typeof SkillRefSchema.Type,
) {
  yield* assertScopeExists(deps, ref.scope);
  yield* reconcileScope(deps, ref.scope, { threadId: null });
  const headers = yield* deps.store.listSkillRevisions(skillScopeKey(ref.scope), ref.name);
  if (headers.length === 0) {
    return yield* new SkillNotFoundError({ detail: `Skill not found: ${ref.name}` });
  }
  return { revisions: headers.map(summarize) };
});

export const skillRevision = Effect.fn("bot.skills.revision")(function* (
  deps: SkillDeps,
  request: typeof SkillRevisionRequestSchema.Type,
) {
  yield* assertScopeExists(deps, request.scope);
  yield* reconcileScope(deps, request.scope, { threadId: null });
  const record = yield* deps.store.getSkillRevision(
    skillScopeKey(request.scope),
    request.name,
    request.revision,
  );
  if (record === null) {
    return yield* new SkillNotFoundError({
      detail: `Revision ${request.revision} of ${request.name} not found.`,
    });
  }
  return { revision: { ...summarize(record), content: record.content } };
});

/**
 * Every user-made change takes the scope lock and reconciles first with no settle wait, so a file
 * that was edited behind the editor's back becomes its own revision and shows up as a conflict
 * instead of being overwritten unrecorded.
 */
const writeUnderLock = <A, E, R>(
  deps: SkillDeps,
  scope: SkillScope,
  body: Effect.Effect<A, E, R>,
) =>
  withScopeLock(
    deps,
    scope,
    Effect.gen(function* () {
      yield* assertScopeExists(deps, scope);
      yield* reconcileLocked(deps, scope, { threadId: null, settleMs: 0 });
      return yield* body;
    }),
  );

export const saveSkill = Effect.fn("bot.skills.save")(function* (
  deps: SkillDeps,
  request: typeof SkillSaveRequestSchema.Type,
) {
  const invalid = checkContent(request.content);
  if (invalid !== null) return yield* invalid;
  const scopeKey = skillScopeKey(request.scope);
  return yield* writeUnderLock(
    deps,
    request.scope,
    Effect.gen(function* () {
      const latest = yield* deps.store.latestSkillRevision(scopeKey, request.name);
      const live = latest !== null && latest.content !== null;
      const stale =
        request.expectedRevision === null ? live : latest?.revision !== request.expectedRevision;
      if (stale) return yield* new SkillConflictError({ detail: conflictDetail(latest) });
      const contentHash = hashSkillContent(request.content);
      if (live && latest.contentHash === contentHash) return { revision: summarize(latest) };
      if (!live) yield* assertNameFree(deps, request.scope, request.name);
      yield* writeSkillFile(deps, request.scope, request.name, request.content);
      const inserted = yield* deps.store.insertSkillRevision({
        scopeKey,
        skill: request.name,
        revision: (latest?.revision ?? 0) + 1,
        parentRevision: latest?.revision ?? null,
        content: request.content,
        contentHash,
        trigger: "user_manual",
        reason: cleanReason(request.reason, "Edited by hand"),
        threadId: null,
        botId: null,
        suggestionId: null,
      });
      return { revision: summarize(inserted) };
    }),
  );
});

export const deleteSkill = Effect.fn("bot.skills.delete")(function* (
  deps: SkillDeps,
  request: typeof SkillDeleteRequestSchema.Type,
) {
  const scopeKey = skillScopeKey(request.scope);
  return yield* writeUnderLock(
    deps,
    request.scope,
    Effect.gen(function* () {
      const latest = yield* deps.store.latestSkillRevision(scopeKey, request.name);
      if (latest === null || latest.content === null) {
        return yield* new SkillNotFoundError({ detail: `Skill not found: ${request.name}` });
      }
      if (latest.revision !== request.expectedRevision) {
        return yield* new SkillConflictError({ detail: conflictDetail(latest) });
      }
      yield* removeSkillFile(deps, request.scope, request.name);
      const inserted = yield* deps.store.insertSkillRevision({
        scopeKey,
        skill: request.name,
        revision: latest.revision + 1,
        parentRevision: latest.revision,
        content: null,
        contentHash: "",
        trigger: "user_manual",
        reason: cleanReason(request.reason, "Deleted by hand"),
        threadId: null,
        botId: null,
        suggestionId: null,
      });
      return { revision: summarize(inserted) };
    }),
  );
});

export const restoreSkill = Effect.fn("bot.skills.restore")(function* (
  deps: SkillDeps,
  request: typeof SkillRestoreRequestSchema.Type,
) {
  const scopeKey = skillScopeKey(request.scope);
  return yield* writeUnderLock(
    deps,
    request.scope,
    Effect.gen(function* () {
      const target = yield* deps.store.getSkillRevision(scopeKey, request.name, request.revision);
      if (target === null) {
        return yield* new SkillNotFoundError({
          detail: `Revision ${request.revision} of ${request.name} not found.`,
        });
      }
      if (target.content === null) {
        return yield* new SkillValidationError({
          detail: `Revision ${request.revision} is a deletion, so there is nothing to restore from it.`,
        });
      }
      const latest = yield* deps.store.latestSkillRevision(scopeKey, request.name);
      if (latest === null || latest.revision !== request.expectedRevision) {
        return yield* new SkillConflictError({ detail: conflictDetail(latest) });
      }
      const live = latest.content !== null;
      if (live && latest.contentHash === target.contentHash) return { revision: summarize(latest) };
      if (!live) yield* assertNameFree(deps, request.scope, request.name);
      yield* writeSkillFile(deps, request.scope, request.name, target.content);
      const inserted = yield* deps.store.insertSkillRevision({
        scopeKey,
        skill: request.name,
        revision: latest.revision + 1,
        parentRevision: latest.revision,
        content: target.content,
        contentHash: target.contentHash,
        trigger: "user_manual",
        reason: `Restored revision ${request.revision}`,
        threadId: null,
        botId: null,
        suggestionId: null,
      });
      return { revision: summarize(inserted) };
    }),
  );
});

/** Pending suggestions from every scope, newest first. */
export const listSuggestions = Effect.fn("bot.skills.suggestions")(function* (deps: SkillDeps) {
  yield* reconcileScopes(deps, yield* listAllSkillScopes(deps.stateDir), { threadId: null });
  const pending = yield* deps.store.listSkillSuggestions("pending");
  return { suggestions: pending.map(toWireSuggestion) };
});

export const dismissSuggestion = Effect.fn("bot.skills.dismissSuggestion")(function* (
  deps: SkillDeps,
  id: string,
) {
  const decided = yield* deps.store.decideSkillSuggestion(id, "dismissed");
  if (decided === null) {
    return yield* new SkillNotFoundError({ detail: `Suggestion not found: ${id}` });
  }
  return { suggestion: toWireSuggestion(decided) };
});

/**
 * The user's yes. It only tells the suggesting bot to go ahead; the suggestion turns `accepted`
 * when the reconciler sees the bot's `change` entry and its edit. A repeated accept reuses one
 * `clientRequestId`, so the host delivers the message once.
 */
export const acceptSuggestion = Effect.fn("bot.skills.acceptSuggestion")(function* (
  deps: SkillCommandDeps,
  id: string,
) {
  const suggestion = yield* deps.store.getSkillSuggestion(id);
  if (suggestion === null) {
    return yield* new SkillNotFoundError({ detail: `Suggestion not found: ${id}` });
  }
  if (suggestion.status !== "pending") {
    return yield* new SkillConflictError({
      detail: `This suggestion was already ${suggestion.status}.`,
    });
  }
  const { orchestration, ensureHome } = deps;
  if (orchestration === undefined || ensureHome === undefined) {
    return yield* new SkillUnavailableError({ detail: "Bot orchestration is unavailable." });
  }
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const scope = parseSkillScopeKey(suggestion.scopeKey);
  const root = skillScopeRoot(path, directory, scope);
  const home = yield* ensureHome(suggestion.botId);
  if (home.homeThreadId === null) {
    return yield* new SkillUnavailableError({ detail: "The bot has no Home thread to message." });
  }
  const where = scope.scope === "shared" ? "shared skills" : "your own skills";
  yield* orchestration.sendMessage({
    threadId: home.homeThreadId,
    text: [
      `The user approved suggestion ${suggestion.id}: ${suggestion.action} the skill "${suggestion.skill}" in the ${where} folder${root === null ? "" : ` (${root})`}.`,
      `Lesson: ${suggestion.message}`,
      `Follow the skill-improver skill: write a "change" inbox entry with basis "suggested" and suggestionId "${suggestion.id}" first, then make the edit.`,
    ].join("\n"),
    clientRequestId: `bot:skill-suggestion:${suggestion.id}`,
  });
  return { suggestion: toWireSuggestion(suggestion) };
});

export const getReviewSettings = Effect.fn("bot.skills.reviewSettings")(function* (
  deps: SkillDeps,
) {
  return { settings: yield* deps.store.getSkillReviewSettings() };
});

/** Setting what is already set changes nothing, so a repeated request is safe. */
export const setReviewSettings = Effect.fn("bot.skills.setReviewSettings")(function* (
  deps: SkillDeps,
  settings: typeof SkillReviewSettingsSchema.Type,
) {
  return { settings: yield* deps.store.setSkillReviewSettings(settings) };
});

/** Starts reviews of the bot's chats with unreviewed runs, whatever the switch says. Does not wait for them. */
export const reviewBotNow = Effect.fn("bot.skills.reviewNow")(function* (
  deps: SkillCommandDeps,
  botId: string,
) {
  yield* assertScopeExists(deps, { scope: "bot", botId });
  if (deps.skillReview === undefined) {
    return yield* new SkillUnavailableError({ detail: "Bot orchestration is unavailable." });
  }
  return yield* deps.skillReview.reviewNow(botId);
});

/**
 * Writes each shipped skill to the shared folder once. A skill that was ever recorded (the user
 * deleted it, say) or whose file is already there is left alone: nothing here overwrites.
 */
export const installBuiltinSkills = Effect.fn("bot.skills.installBuiltin")(function* (
  deps: SkillDeps,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  const root = sharedSkillsRoot(path, directory);
  yield* withScopeLock(
    deps,
    { scope: "shared" },
    Effect.gen(function* () {
      yield* fs
        .makeDirectory(path.join(root, ".inbox"), { recursive: true })
        .pipe(Effect.mapError((cause) => new BotCreateIoError({ detail: String(cause) })));
      for (const name of BUILTIN_SKILL_NAMES) {
        const file = path.join(root, name, "SKILL.md");
        if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => true))) continue;
        if ((yield* deps.store.latestSkillRevision("shared", name)) !== null) continue;
        const content = BUILTIN_SKILL_FILES[name];
        yield* writeSkillFile(deps, { scope: "shared" }, name, content);
        yield* deps.store.insertSkillRevision({
          scopeKey: "shared",
          skill: name,
          revision: 1,
          parentRevision: null,
          content,
          contentHash: hashSkillContent(content),
          trigger: "builtin",
          reason: "Shipped with Bot",
          threadId: null,
          botId: null,
          suggestionId: null,
        });
      }
    }),
  );
});

/** Where `<command>` of `/api/bots/skills/<command>` goes. Unknown names are a 404. */
export const runSkillCommand = Effect.fn("bot.skills.command")(function* (
  deps: SkillCommandDeps,
  command: string,
  body: unknown,
) {
  switch (command) {
    case BOT_SKILL_COMMANDS.list:
      return yield* decodeListRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => listSkills(deps, request.scope)),
      );
    case BOT_SKILL_COMMANDS.history:
      return yield* decodeRefRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => skillHistory(deps, request)),
      );
    case BOT_SKILL_COMMANDS.revision:
      return yield* decodeRevisionRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => skillRevision(deps, request)),
      );
    case BOT_SKILL_COMMANDS.save:
      return yield* decodeSaveRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => saveSkill(deps, request)),
      );
    case BOT_SKILL_COMMANDS.delete:
      return yield* decodeDeleteRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => deleteSkill(deps, request)),
      );
    case BOT_SKILL_COMMANDS.restore:
      return yield* decodeRestoreRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => restoreSkill(deps, request)),
      );
    case BOT_SKILL_COMMANDS.suggestions:
      return yield* listSuggestions(deps);
    case BOT_SKILL_COMMANDS.acceptSuggestion:
      return yield* decodeDecisionRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => acceptSuggestion(deps, request.id)),
      );
    case BOT_SKILL_COMMANDS.dismissSuggestion:
      return yield* decodeDecisionRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => dismissSuggestion(deps, request.id)),
      );
    case BOT_SKILL_COMMANDS.reviewSettings:
      return yield* getReviewSettings(deps);
    case BOT_SKILL_COMMANDS.setReviewSettings:
      return yield* decodeReviewSettings(body).pipe(
        asBadBody,
        Effect.flatMap((settings) => setReviewSettings(deps, settings)),
      );
    case BOT_SKILL_COMMANDS.reviewNow:
      return yield* decodeReviewNowRequest(body).pipe(
        asBadBody,
        Effect.flatMap((request) => reviewBotNow(deps, request.botId)),
      );
    default:
      return yield* new SkillNotFoundError({ detail: `Unknown skill command: ${command}` });
  }
});
