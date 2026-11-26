// @effect-diagnostics nodeBuiltinImport:off -- Content hashes and ids use node:crypto.
import * as NodeCrypto from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  SkillInboxEntrySchema,
  SkillNameSchema,
  skillScopeKey,
  type SkillInboxEntry,
  type SkillScope,
} from "../contracts.ts";
import type { BotStoreShape, SkillRevisionRecord } from "./db.ts";
import { skillScopeRoot } from "./skillRoots.ts";
import { resolveBotStoragePaths } from "./storage.ts";

export interface SkillDeps {
  readonly stateDir: string;
  readonly store: BotStoreShape;
}

/** A file this young may still be mid-edit, with its inbox entry not yet written. */
export const SKILL_SETTLE_MS = 60_000;
/** A `change` entry nobody's edit consumed in this long is dropped. */
export const SKILL_INBOX_TTL_MS = 24 * 60 * 60 * 1000;
export const SKILL_MAX_CHARS = 256 * 1024;
const INBOX_MAX_CHARS = 64 * 1024;

const decodeInboxFile = Schema.decodeUnknownOption(Schema.fromJsonString(SkillInboxEntrySchema));
const decodeSkillName = Schema.decodeOption(SkillNameSchema);
const isSkillName = (name: string) => Option.isSome(decodeSkillName(name));

type ChangeEntry = Extract<SkillInboxEntry, { readonly kind: "change" }>;

interface InboxChange {
  readonly file: string;
  readonly mtimeMs: number;
  readonly entry: ChangeEntry;
}

export interface ReconcileOptions {
  /** The thread whose run just ended; null when a command (not a run) asked. */
  readonly threadId: string | null;
  /** Overrides `SKILL_SETTLE_MS`; commands that are about to overwrite a file pass 0. */
  readonly settleMs?: number | undefined;
}

/** Line endings must not make a skill look edited. */
export function normalizeSkillContent(content: string): string {
  return content.replaceAll(/\r\n?/g, "\n");
}

export function hashSkillContent(content: string): string {
  return NodeCrypto.createHash("sha256").update(normalizeSkillContent(content)).digest("hex");
}

// One lock per scope, shared by the HTTP commands and the run-end hook in this process.
const scopeLocks = new Map<string, Semaphore.Semaphore>();

export function withScopeLock<A, E, R>(
  deps: Pick<SkillDeps, "stateDir">,
  scope: SkillScope,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const key = `${deps.stateDir}\u0000${skillScopeKey(scope)}`;
  let lock = scopeLocks.get(key);
  if (lock === undefined) {
    lock = Semaphore.makeUnsafe(1);
    scopeLocks.set(key, lock);
  }
  return lock.withPermits(1)(effect);
}

const mtimeMsOf = (info: FileSystem.File.Info) =>
  Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() });

function newestFirst(entries: ReadonlyArray<InboxChange>): ReadonlyArray<InboxChange> {
  return [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Turns what changed on disk since the last pass into revisions. Call it while holding the scope
 * lock. Files are the truth for content and the store is the truth for history, so the pass only
 * ever adds revisions; it never touches a skill file.
 */
export const reconcileLocked = Effect.fn("bot.skills.reconcile")(function* (
  deps: SkillDeps,
  scope: SkillScope,
  options: ReconcileOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory: botsDir } = yield* resolveBotStoragePaths(deps.stateDir);
  const root = skillScopeRoot(path, botsDir, scope);
  if (root === null) return;
  // A root that is not there is a folder never made or a drive not mounted, not a mass deletion.
  const rootInfo = yield* fs.stat(root).pipe(Effect.option);
  if (rootInfo._tag === "None" || rootInfo.value.type !== "Directory") return;

  const scopeKey = skillScopeKey(scope);
  const settleMs = options.settleMs ?? SKILL_SETTLE_MS;
  const now = (yield* DateTime.nowAsDate).getTime();
  const inboxDir = path.join(root, ".inbox");

  const dropFile = (file: string) => fs.remove(file, { force: true }).pipe(Effect.ignore);

  // 1. Inbox: suggestions become rows, changes wait for their edit, anything else is junk.
  const changes: Array<InboxChange> = [];
  const inboxFiles = yield* fs.readDirectory(inboxDir).pipe(Effect.orElseSucceed(() => []));
  for (const fileName of [...inboxFiles].sort()) {
    if (!fileName.endsWith(".json")) continue;
    const file = path.join(inboxDir, fileName);
    const info = yield* fs.stat(file).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") continue;
    const text = yield* fs.readFileString(file).pipe(Effect.option);
    if (text._tag === "None") continue;
    const entry = text.value.length > INBOX_MAX_CHARS ? Option.none() : decodeInboxFile(text.value);
    if (Option.isNone(entry)) {
      yield* Effect.logWarning("bot skill inbox entry is invalid and was deleted", { file });
      yield* dropFile(file);
      continue;
    }
    if (entry.value.kind === "suggest") {
      const stem = fileName.slice(0, -".json".length);
      yield* deps.store.insertSkillSuggestion({
        id: /^[A-Za-z0-9-]{1,64}$/.test(stem) ? stem : NodeCrypto.randomUUID(),
        scopeKey,
        skill: entry.value.name,
        action: entry.value.action,
        signal: entry.value.signal,
        message: entry.value.message,
        threadId: options.threadId,
        botId: entry.value.botId,
      });
      yield* dropFile(file);
      continue;
    }
    changes.push({ file, mtimeMs: mtimeMsOf(info.value), entry: entry.value });
  }

  // 2. Skills: every folder with a SKILL.md, plus everything ever recorded (to see deletions).
  const latestByName = new Map<string, SkillRevisionRecord>(
    (yield* deps.store.listLatestSkillRevisions(scopeKey)).map((record) => [record.skill, record]),
  );
  const onDisk = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
  const names = new Set([...latestByName.keys(), ...onDisk.filter(isSkillName)]);
  const consumed = new Set<string>();

  for (const name of [...names].sort()) {
    const skillFile = path.join(root, name, "SKILL.md");
    const info = yield* fs.stat(skillFile).pipe(Effect.option);
    const latest = latestByName.get(name) ?? null;
    const present = info._tag === "Some" && info.value.type === "File";

    let content: string | null = null;
    let mtimeMs = 0;
    if (present) {
      const text = yield* fs.readFileString(skillFile).pipe(Effect.option);
      if (text._tag === "None") continue;
      if (text.value.length > SKILL_MAX_CHARS) {
        yield* Effect.logWarning("bot skill is too large to record and was skipped", { skillFile });
        continue;
      }
      content = text.value;
      mtimeMs = mtimeMsOf(info.value);
    }

    const contentHash = content === null ? "" : hashSkillContent(content);
    const unchanged =
      content === null
        ? latest === null || latest.content === null
        : latest?.contentHash === contentHash;
    if (unchanged) continue;

    const entry = newestFirst(changes.filter((change) => change.entry.name === name))[0];
    // The agent writes its entry before the edit, but the entry may not have landed yet.
    if (entry === undefined && content !== null && now - mtimeMs < settleMs) continue;

    // An unknown suggestion id is dropped, so the revision never points at the wrong suggestion.
    const suggestion =
      entry?.entry.suggestionId === undefined
        ? null
        : yield* deps.store.getSkillSuggestion(entry.entry.suggestionId);
    const suggestionId =
      suggestion !== null && suggestion.scopeKey === scopeKey && suggestion.skill === name
        ? suggestion.id
        : null;

    const inserted = yield* deps.store.insertSkillRevision({
      scopeKey,
      skill: name,
      revision: (latest?.revision ?? 0) + 1,
      parentRevision: latest?.revision ?? null,
      content,
      contentHash,
      trigger: entry?.entry.basis ?? "external",
      reason: entry?.entry.reason.trim() ?? "",
      threadId: entry === undefined ? null : options.threadId,
      botId: entry?.entry.botId ?? null,
      suggestionId,
    });
    latestByName.set(name, inserted);
    if (suggestionId !== null) yield* deps.store.decideSkillSuggestion(suggestionId, "accepted");
    for (const change of changes) {
      if (change.entry.name !== name) continue;
      consumed.add(change.file);
      yield* dropFile(change.file);
    }
  }

  // 3. A change whose edit never came is not worth keeping forever.
  for (const change of changes) {
    if (consumed.has(change.file) || now - change.mtimeMs <= SKILL_INBOX_TTL_MS) continue;
    yield* dropFile(change.file);
  }
});

export const reconcileScope = (deps: SkillDeps, scope: SkillScope, options: ReconcileOptions) =>
  withScopeLock(deps, scope, reconcileLocked(deps, scope, options));

/** Each scope on its own lock, one after the other, so a slow one never holds the rest. */
export const reconcileScopes = Effect.fn("bot.skills.reconcileScopes")(function* (
  deps: SkillDeps,
  scopes: ReadonlyArray<SkillScope>,
  options: ReconcileOptions,
) {
  for (const scope of scopes) yield* reconcileScope(deps, scope, options);
});

/** `shared` plus one scope per bot folder under `<stateDir>/bots/`. */
export const listAllSkillScopes = Effect.fn("bot.skills.listAllScopes")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory } = yield* resolveBotStoragePaths(stateDir);
  const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
  const botIds: Array<string> = [];
  for (const entry of [...entries].sort()) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const yaml = yield* fs.stat(path.join(directory, entry, "bot.yaml")).pipe(Effect.option);
    if (yaml._tag === "Some" && yaml.value.type === "File") botIds.push(entry);
  }
  return [
    { scope: "shared" },
    ...botIds.map((botId) => ({ scope: "bot", botId })),
  ] as ReadonlyArray<SkillScope>;
});
