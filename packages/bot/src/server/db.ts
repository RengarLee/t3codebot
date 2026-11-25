// @effect-diagnostics nodeBuiltinImport:off -- Isolated bot SQLite store backed by built-in node:sqlite.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type { BotHomeRecord, BotSessionReceipt, SkillTrigger } from "../contracts.ts";
import { BotServerHost } from "./host.ts";
import { resolveBotStoragePaths } from "./storage.ts";

/** Where a bot's sessions live: its T3 project and its Home thread there. */
export interface BotHome {
  readonly projectId: string;
  readonly homeThreadId: string | null;
}

/**
 * One row of a skill's history. `scopeKey` is `shared` or `bot:<id>`; `content` is null when the
 * skill was deleted at this revision (a tombstone, which has an empty `contentHash`).
 */
export interface SkillRevisionRecord {
  readonly scopeKey: string;
  readonly skill: string;
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly content: string | null;
  readonly contentHash: string;
  readonly trigger: SkillTrigger;
  readonly reason: string;
  readonly threadId: string | null;
  readonly botId: string | null;
  readonly suggestionId: string | null;
  readonly createdAt: string;
}

export type NewSkillRevision = Omit<SkillRevisionRecord, "createdAt">;

/** A revision without its content, for listing a long history cheaply. */
export type SkillRevisionHeader = Omit<SkillRevisionRecord, "content"> & {
  readonly deleted: boolean;
};

export type SkillSuggestionStatus = "pending" | "accepted" | "dismissed";

export interface SkillSuggestionRecord {
  readonly id: string;
  readonly scopeKey: string;
  readonly skill: string;
  readonly action: "create" | "update";
  readonly signal: "correction" | "technique" | "outdated_skill";
  readonly message: string;
  readonly threadId: string | null;
  readonly botId: string;
  readonly status: SkillSuggestionStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export type NewSkillSuggestion = Omit<SkillSuggestionRecord, "status" | "createdAt" | "decidedAt">;

/** The validated receipt a session last handed back, keyed by its T3 thread id. */
export interface BotSessionReceiptRecord extends BotSessionReceipt {
  readonly threadId: string;
  readonly receivedAt: string;
}

export class BotStoreError extends Schema.TaggedError<
  BotStoreError,
  { readonly brand: unique symbol }
>()("BotStoreError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `BotStore.${this.operation}: ${this.detail}`;
  }
}

export interface BotStoreShape {
  readonly sqlitePath: string;
  readonly getHome: (botId: string) => Effect.Effect<BotHomeRecord | null, BotStoreError>;
  readonly getHomesByBot: () => Effect.Effect<ReadonlyMap<string, BotHome>, BotStoreError>;
  readonly upsertHome: (
    botId: string,
    input: { readonly homeThreadId: string | null; readonly projectId: string | null },
  ) => Effect.Effect<BotHomeRecord, BotStoreError>;
  readonly upsertSessionReceipt: (
    botId: string,
    threadId: string,
    receipt: BotSessionReceipt,
  ) => Effect.Effect<void, BotStoreError>;
  readonly listSessionReceipts: (
    botId: string,
  ) => Effect.Effect<ReadonlyArray<BotSessionReceiptRecord>, BotStoreError>;
  /** Fails when `(scopeKey, skill, revision)` already exists, so two writers cannot both claim a number. */
  readonly insertSkillRevision: (
    input: NewSkillRevision,
  ) => Effect.Effect<SkillRevisionRecord, BotStoreError>;
  readonly getSkillRevision: (
    scopeKey: string,
    skill: string,
    revision: number,
  ) => Effect.Effect<SkillRevisionRecord | null, BotStoreError>;
  readonly latestSkillRevision: (
    scopeKey: string,
    skill: string,
  ) => Effect.Effect<SkillRevisionRecord | null, BotStoreError>;
  /** The newest revision of every skill in the scope, deleted ones included. */
  readonly listLatestSkillRevisions: (
    scopeKey: string,
  ) => Effect.Effect<ReadonlyArray<SkillRevisionRecord>, BotStoreError>;
  /** Newest first. */
  readonly listSkillRevisions: (
    scopeKey: string,
    skill: string,
  ) => Effect.Effect<ReadonlyArray<SkillRevisionHeader>, BotStoreError>;
  /** A suggestion with this id already stored is returned as is, so re-reading an inbox file is safe. */
  readonly insertSkillSuggestion: (
    input: NewSkillSuggestion,
  ) => Effect.Effect<SkillSuggestionRecord, BotStoreError>;
  readonly getSkillSuggestion: (
    id: string,
  ) => Effect.Effect<SkillSuggestionRecord | null, BotStoreError>;
  /** Newest first. */
  readonly listSkillSuggestions: (
    status: SkillSuggestionStatus,
  ) => Effect.Effect<ReadonlyArray<SkillSuggestionRecord>, BotStoreError>;
  /** Only a pending suggestion changes; any other is returned untouched. Null when unknown. */
  readonly decideSkillSuggestion: (
    id: string,
    status: "accepted" | "dismissed",
  ) => Effect.Effect<SkillSuggestionRecord | null, BotStoreError>;
}

export class BotStore extends Context.Service<BotStore, BotStoreShape>()(
  "@t3tools/bot/server/db/BotStore",
) {}

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: "init_bot_homes_tasks_cards",
    sql: `
      CREATE TABLE IF NOT EXISTS bot_homes (
        bot_id TEXT PRIMARY KEY,
        home_thread_id TEXT,
        project_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_tasks (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        child_thread_id TEXT,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'waiting_user', 'completed', 'archived')),
        latest_decision TEXT,
        latest_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_bot_tasks_bot_status
        ON bot_tasks (bot_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS bot_home_cards (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        task_id TEXT REFERENCES bot_tasks(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('task_dispatched', 'task_decision', 'task_status')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bot_home_cards_bot_created
        ON bot_home_cards (bot_id, created_at DESC);
    `,
  },
  {
    version: 2,
    name: "idx_bot_tasks_child_thread",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_bot_tasks_child_thread
        ON bot_tasks (child_thread_id)
        WHERE child_thread_id IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: "drop_tasks_and_cards",
    sql: `
      DROP TABLE IF EXISTS bot_home_cards;
      DROP TABLE IF EXISTS bot_tasks;
    `,
  },
  {
    version: 4,
    name: "session_receipts",
    sql: `
      CREATE TABLE IF NOT EXISTS bot_session_receipts (
        thread_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('done', 'blocked', 'needs_decision')),
        outcome TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bot_session_receipts_bot
        ON bot_session_receipts (bot_id, received_at DESC);

      DROP TABLE IF EXISTS bot_session_summaries;
    `,
  },
  {
    version: 5,
    name: "session_receipt_waiting_user",
    sql: `
      CREATE TABLE bot_session_receipts_next (
        thread_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('done', 'blocked', 'needs_decision', 'waiting_user')),
        outcome TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      INSERT INTO bot_session_receipts_next SELECT * FROM bot_session_receipts;
      DROP TABLE bot_session_receipts;
      ALTER TABLE bot_session_receipts_next RENAME TO bot_session_receipts;
      CREATE INDEX idx_bot_session_receipts_bot ON bot_session_receipts (bot_id, received_at DESC);
    `,
  },
  {
    version: 6,
    name: "skill_revisions_and_suggestions",
    sql: `
      CREATE TABLE bot_skill_revisions (
        scope_key TEXT NOT NULL,
        skill TEXT NOT NULL,
        revision INTEGER NOT NULL,
        parent_revision INTEGER,
        content TEXT,
        content_hash TEXT NOT NULL,
        "trigger" TEXT NOT NULL
          CHECK ("trigger" IN ('builtin', 'user_manual', 'user_request', 'suggested', 'external')),
        reason TEXT NOT NULL,
        thread_id TEXT,
        bot_id TEXT,
        suggestion_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, skill, revision)
      );

      CREATE TABLE bot_skill_suggestions (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        skill TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'update')),
        signal TEXT NOT NULL CHECK (signal IN ('correction', 'technique', 'outdated_skill')),
        message TEXT NOT NULL,
        thread_id TEXT,
        bot_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'dismissed')),
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX idx_bot_skill_suggestions_status
        ON bot_skill_suggestions (status, created_at DESC);
    `,
  },
];

interface RawSkillRevisionRow {
  readonly scope_key: string;
  readonly skill: string;
  readonly revision: number;
  readonly parent_revision: number | null;
  readonly content: string | null;
  readonly content_hash: string;
  readonly trigger: SkillTrigger;
  readonly reason: string;
  readonly thread_id: string | null;
  readonly bot_id: string | null;
  readonly suggestion_id: string | null;
  readonly created_at: string;
}

interface RawSkillSuggestionRow {
  readonly id: string;
  readonly scope_key: string;
  readonly skill: string;
  readonly action: SkillSuggestionRecord["action"];
  readonly signal: SkillSuggestionRecord["signal"];
  readonly message: string;
  readonly thread_id: string | null;
  readonly bot_id: string;
  readonly status: SkillSuggestionStatus;
  readonly created_at: string;
  readonly decided_at: string | null;
}

const SKILL_REVISION_COLUMNS = `scope_key, skill, revision, parent_revision, content, content_hash,
  "trigger" AS "trigger", reason, thread_id, bot_id, suggestion_id, created_at`;

const SKILL_SUGGESTION_COLUMNS = `id, scope_key, skill, action, signal, message, thread_id, bot_id,
  status, created_at, decided_at`;

function mapSkillRevisionRow(row: RawSkillRevisionRow): SkillRevisionRecord {
  return {
    scopeKey: row.scope_key,
    skill: row.skill,
    revision: row.revision,
    parentRevision: row.parent_revision,
    content: row.content,
    contentHash: row.content_hash,
    trigger: row.trigger,
    reason: row.reason,
    threadId: row.thread_id,
    botId: row.bot_id,
    suggestionId: row.suggestion_id,
    createdAt: row.created_at,
  };
}

function mapSkillSuggestionRow(row: RawSkillSuggestionRow): SkillSuggestionRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    skill: row.skill,
    action: row.action,
    signal: row.signal,
    message: row.message,
    threadId: row.thread_id,
    botId: row.bot_id,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

interface RawHomeRow {
  readonly bot_id: string;
  readonly home_thread_id: string | null;
  readonly project_id: string | null;
  readonly updated_at: string;
}

const decodeArtifacts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

function mapHomeRow(row: RawHomeRow): BotHomeRecord {
  return {
    botId: row.bot_id,
    homeThreadId: row.home_thread_id,
    projectId: row.project_id,
    updatedAt: row.updated_at,
  };
}

function runMigrations(db: NodeSqlite.DatabaseSync, appliedAt: string): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS bot_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version FROM bot_schema_migrations")
    .all() as unknown as ReadonlyArray<{ readonly version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO bot_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, appliedAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function makeBotStoreError(operation: string, cause: unknown): BotStoreError {
  return new BotStoreError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

const currentIsoNow = Effect.map(DateTime.now, DateTime.formatIso);

export function openBotStore(
  sqlitePath: string,
): Effect.Effect<BotStoreShape, BotStoreError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const appliedAt = yield* currentIsoNow;
      return yield* Effect.try({
        try: () => {
          if (sqlitePath !== ":memory:") {
            NodeFS.mkdirSync(NodePath.dirname(sqlitePath), { recursive: true });
          }
          const db = new NodeSqlite.DatabaseSync(sqlitePath);
          runMigrations(db, appliedAt);
          return db;
        },
        catch: (cause) => makeBotStoreError("open", cause),
      });
    }),
    (db) =>
      Effect.sync(() => {
        try {
          db.close();
        } catch {
          // Ignore close errors during shutdown.
        }
      }),
  ).pipe(Effect.map((db) => createBotStoreFromDb(sqlitePath, db)));
}

function createBotStoreFromDb(sqlitePath: string, db: NodeSqlite.DatabaseSync): BotStoreShape {
  const tryOp = <A>(operation: string, thunk: () => A): Effect.Effect<A, BotStoreError> =>
    Effect.try({
      try: thunk,
      catch: (cause) => makeBotStoreError(operation, cause),
    });

  const selectHome = (botId: string): BotHomeRecord | null => {
    const row = db
      .prepare(
        "SELECT bot_id, home_thread_id, project_id, updated_at FROM bot_homes WHERE bot_id = ?",
      )
      .get(botId) as unknown as RawHomeRow | undefined;
    return row ? mapHomeRow(row) : null;
  };

  return {
    sqlitePath,

    getHome: (botId) => tryOp("getHome", () => selectHome(botId)),

    getHomesByBot: () =>
      tryOp("getHomesByBot", () => {
        const rows = db
          .prepare(
            "SELECT bot_id, project_id, home_thread_id FROM bot_homes WHERE project_id IS NOT NULL",
          )
          .all() as unknown as ReadonlyArray<{
          bot_id: string;
          project_id: string;
          home_thread_id: string | null;
        }>;
        return new Map(
          rows.map((row) => [
            row.bot_id,
            { projectId: row.project_id, homeThreadId: row.home_thread_id },
          ]),
        );
      }),

    upsertHome: Effect.fn("bot.db.upsertHome")(function* (botId, input) {
      const now = yield* currentIsoNow;
      return yield* tryOp("upsertHome", () => {
        db.prepare(
          `INSERT INTO bot_homes (bot_id, home_thread_id, project_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(bot_id) DO UPDATE SET
             home_thread_id = excluded.home_thread_id,
             project_id = excluded.project_id,
             updated_at = excluded.updated_at`,
        ).run(botId, input.homeThreadId, input.projectId, now);
        return {
          botId,
          homeThreadId: input.homeThreadId,
          projectId: input.projectId,
          updatedAt: now,
        } satisfies BotHomeRecord;
      });
    }),

    upsertSessionReceipt: Effect.fn("bot.db.upsertSessionReceipt")(
      function* (botId, threadId, receipt) {
        const now = yield* currentIsoNow;
        yield* tryOp("upsertSessionReceipt", () => {
          db.prepare(
            `INSERT INTO bot_session_receipts
               (thread_id, bot_id, status, outcome, artifacts_json, received_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(thread_id) DO UPDATE SET
               status = excluded.status,
               outcome = excluded.outcome,
               artifacts_json = excluded.artifacts_json,
               received_at = excluded.received_at`,
          ).run(
            threadId,
            botId,
            receipt.status,
            receipt.outcome,
            JSON.stringify(receipt.artifacts),
            now,
          );
        });
      },
    ),

    listSessionReceipts: (botId) =>
      tryOp("listSessionReceipts", () => {
        const rows = db
          .prepare(
            `SELECT thread_id, status, outcome, artifacts_json, received_at
               FROM bot_session_receipts
              WHERE bot_id = ?
              ORDER BY received_at DESC`,
          )
          .all(botId) as unknown as ReadonlyArray<{
          thread_id: string;
          status: BotSessionReceipt["status"];
          outcome: string;
          artifacts_json: string;
          received_at: string;
        }>;
        return rows.map((row) => ({
          threadId: row.thread_id,
          status: row.status,
          outcome: row.outcome,
          artifacts: decodeArtifacts(row.artifacts_json),
          receivedAt: row.received_at,
        }));
      }),

    insertSkillRevision: Effect.fn("bot.db.insertSkillRevision")(function* (input) {
      const createdAt = yield* currentIsoNow;
      return yield* tryOp("insertSkillRevision", () => {
        db.prepare(
          `INSERT INTO bot_skill_revisions
             (scope_key, skill, revision, parent_revision, content, content_hash, "trigger",
              reason, thread_id, bot_id, suggestion_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.scopeKey,
          input.skill,
          input.revision,
          input.parentRevision,
          input.content,
          input.contentHash,
          input.trigger,
          input.reason,
          input.threadId,
          input.botId,
          input.suggestionId,
          createdAt,
        );
        return { ...input, createdAt } satisfies SkillRevisionRecord;
      });
    }),

    getSkillRevision: (scopeKey, skill, revision) =>
      tryOp("getSkillRevision", () => {
        const row = db
          .prepare(
            `SELECT ${SKILL_REVISION_COLUMNS} FROM bot_skill_revisions
              WHERE scope_key = ? AND skill = ? AND revision = ?`,
          )
          .get(scopeKey, skill, revision) as unknown as RawSkillRevisionRow | undefined;
        return row ? mapSkillRevisionRow(row) : null;
      }),

    latestSkillRevision: (scopeKey, skill) =>
      tryOp("latestSkillRevision", () => {
        const row = db
          .prepare(
            `SELECT ${SKILL_REVISION_COLUMNS} FROM bot_skill_revisions
              WHERE scope_key = ? AND skill = ?
              ORDER BY revision DESC LIMIT 1`,
          )
          .get(scopeKey, skill) as unknown as RawSkillRevisionRow | undefined;
        return row ? mapSkillRevisionRow(row) : null;
      }),

    listLatestSkillRevisions: (scopeKey) =>
      tryOp("listLatestSkillRevisions", () => {
        const rows = db
          .prepare(
            `SELECT ${SKILL_REVISION_COLUMNS} FROM bot_skill_revisions AS r
              WHERE scope_key = ?
                AND revision = (
                  SELECT MAX(revision) FROM bot_skill_revisions
                   WHERE scope_key = r.scope_key AND skill = r.skill
                )
              ORDER BY skill`,
          )
          .all(scopeKey) as unknown as ReadonlyArray<RawSkillRevisionRow>;
        return rows.map(mapSkillRevisionRow);
      }),

    listSkillRevisions: (scopeKey, skill) =>
      tryOp("listSkillRevisions", () => {
        const rows = db
          .prepare(
            `SELECT scope_key, skill, revision, parent_revision, content_hash, "trigger" AS "trigger",
                    reason, thread_id, bot_id, suggestion_id, created_at,
                    content IS NULL AS deleted
               FROM bot_skill_revisions
              WHERE scope_key = ? AND skill = ?
              ORDER BY revision DESC`,
          )
          .all(scopeKey, skill) as unknown as ReadonlyArray<
          Omit<RawSkillRevisionRow, "content"> & { readonly deleted: number }
        >;
        return rows.map(({ deleted, ...row }) => {
          const { content: _content, ...header } = mapSkillRevisionRow({ ...row, content: null });
          return { ...header, deleted: deleted === 1 };
        });
      }),

    insertSkillSuggestion: Effect.fn("bot.db.insertSkillSuggestion")(function* (input) {
      const createdAt = yield* currentIsoNow;
      return yield* tryOp("insertSkillSuggestion", () => {
        db.prepare(
          `INSERT OR IGNORE INTO bot_skill_suggestions
             (id, scope_key, skill, action, signal, message, thread_id, bot_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(
          input.id,
          input.scopeKey,
          input.skill,
          input.action,
          input.signal,
          input.message,
          input.threadId,
          input.botId,
          createdAt,
        );
        const row = db
          .prepare(`SELECT ${SKILL_SUGGESTION_COLUMNS} FROM bot_skill_suggestions WHERE id = ?`)
          .get(input.id) as unknown as RawSkillSuggestionRow;
        return mapSkillSuggestionRow(row);
      });
    }),

    getSkillSuggestion: (id) =>
      tryOp("getSkillSuggestion", () => {
        const row = db
          .prepare(`SELECT ${SKILL_SUGGESTION_COLUMNS} FROM bot_skill_suggestions WHERE id = ?`)
          .get(id) as unknown as RawSkillSuggestionRow | undefined;
        return row ? mapSkillSuggestionRow(row) : null;
      }),

    listSkillSuggestions: (status) =>
      tryOp("listSkillSuggestions", () => {
        const rows = db
          .prepare(
            `SELECT ${SKILL_SUGGESTION_COLUMNS} FROM bot_skill_suggestions
              WHERE status = ?
              ORDER BY created_at DESC, id`,
          )
          .all(status) as unknown as ReadonlyArray<RawSkillSuggestionRow>;
        return rows.map(mapSkillSuggestionRow);
      }),

    decideSkillSuggestion: Effect.fn("bot.db.decideSkillSuggestion")(function* (id, status) {
      const decidedAt = yield* currentIsoNow;
      return yield* tryOp("decideSkillSuggestion", () => {
        db.prepare(
          `UPDATE bot_skill_suggestions SET status = ?, decided_at = ?
            WHERE id = ? AND status = 'pending'`,
        ).run(status, decidedAt, id);
        const row = db
          .prepare(`SELECT ${SKILL_SUGGESTION_COLUMNS} FROM bot_skill_suggestions WHERE id = ?`)
          .get(id) as unknown as RawSkillSuggestionRow | undefined;
        return row ? mapSkillSuggestionRow(row) : null;
      });
    }),
  };
}

export const BotStoreLive = Layer.effect(
  BotStore,
  Effect.gen(function* () {
    const { stateDir } = yield* BotServerHost;
    const paths = yield* resolveBotStoragePaths(stateDir);
    return yield* openBotStore(paths.sqlitePath);
  }),
);
