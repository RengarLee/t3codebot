// @effect-diagnostics nodeBuiltinImport:off -- Isolated bot SQLite store backed by built-in node:sqlite.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type {
  BotBindHomeInput,
  BotCreateTaskInput,
  BotHomeCardKind,
  BotHomeCardRecord,
  BotHomeRecord,
  BotTaskRecord,
  BotTaskStatus,
  BotTasksResponse,
  BotUpdateTaskInput,
} from "../contracts.ts";
import { BotServerHost } from "./host.ts";
import { resolveBotStoragePaths } from "./storage.ts";

export interface BotTaskCounts {
  readonly active: number;
  readonly completed: number;
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

export class BotTaskNotFoundError extends Schema.TaggedError<
  BotTaskNotFoundError,
  { readonly brand: unique symbol }
>()("BotTaskNotFoundError", {
  botId: Schema.String,
  taskId: Schema.String,
}) {
  override get message(): string {
    return `Task '${this.taskId}' was not found for bot '${this.botId}'.`;
  }
}

export class BotStoreValidationError extends Schema.TaggedError<
  BotStoreValidationError,
  { readonly brand: unique symbol }
>()("BotStoreValidationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export type BotStoreFailure = BotStoreError | BotTaskNotFoundError | BotStoreValidationError;

export interface BotStoreShape {
  readonly sqlitePath: string;
  readonly getTaskCountsByBot: () => Effect.Effect<
    ReadonlyMap<string, BotTaskCounts>,
    BotStoreError
  >;
  readonly getHome: (botId: string) => Effect.Effect<BotHomeRecord | null, BotStoreError>;
  readonly getProjectIdsByBot: () => Effect.Effect<ReadonlyMap<string, string>, BotStoreError>;
  readonly upsertHome: (
    botId: string,
    input: BotBindHomeInput,
  ) => Effect.Effect<BotHomeRecord, BotStoreFailure>;
  /**
   * Hard anti-pollution query for Home context assembly:
   * strictly returns only `active` and `waiting_user` tasks, excluding `completed` and `archived`.
   */
  readonly listActiveTasksForHomeContext: (
    botId: string,
  ) => Effect.Effect<ReadonlyArray<BotTaskRecord>, BotStoreError>;
  readonly listBotTasks: (
    botId: string,
    options?: { readonly recentCardsLimit?: number | undefined },
  ) => Effect.Effect<BotTasksResponse, BotStoreError>;
  readonly getTask: (
    botId: string,
    taskId: string,
  ) => Effect.Effect<BotTaskRecord | null, BotStoreError>;
  readonly findTaskByChildThreadId: (
    childThreadId: string,
  ) => Effect.Effect<BotTaskRecord | null, BotStoreError>;
  readonly createTask: (
    botId: string,
    input: BotCreateTaskInput,
  ) => Effect.Effect<
    { readonly task: BotTaskRecord; readonly card: BotHomeCardRecord },
    BotStoreFailure
  >;
  readonly updateTask: (
    botId: string,
    taskId: string,
    input: BotUpdateTaskInput,
  ) => Effect.Effect<
    { readonly task: BotTaskRecord; readonly card: BotHomeCardRecord | null },
    BotStoreFailure
  >;
  readonly deleteTask: (botId: string, taskId: string) => Effect.Effect<boolean, BotStoreError>;
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
];

interface RawHomeRow {
  readonly bot_id: string;
  readonly home_thread_id: string | null;
  readonly project_id: string | null;
  readonly updated_at: string;
}

interface RawTaskRow {
  readonly id: string;
  readonly bot_id: string;
  readonly child_thread_id: string | null;
  readonly title: string;
  readonly goal: string;
  readonly status: BotTaskStatus;
  readonly latest_decision: string | null;
  readonly latest_summary: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

interface RawCardRow {
  readonly id: string;
  readonly bot_id: string;
  readonly task_id: string | null;
  readonly kind: BotHomeCardKind;
  readonly content: string;
  readonly created_at: string;
}

interface RawCountRow {
  readonly bot_id: string;
  readonly status: BotTaskStatus;
  readonly cnt: number;
}

function mapHomeRow(row: RawHomeRow): BotHomeRecord {
  return {
    botId: row.bot_id,
    homeThreadId: row.home_thread_id,
    projectId: row.project_id,
    updatedAt: row.updated_at,
  };
}

function mapTaskRow(row: RawTaskRow): BotTaskRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    childThreadId: row.child_thread_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    latestDecision: row.latest_decision,
    latestSummary: row.latest_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapCardRow(row: RawCardRow): BotHomeCardRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    taskId: row.task_id,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
  };
}

function isTerminalStatus(status: BotTaskStatus): boolean {
  return status === "completed" || status === "archived";
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

function runInTransaction<A>(db: NodeSqlite.DatabaseSync, fn: () => A): A {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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

  const selectTask = (botId: string, taskId: string): BotTaskRecord | null => {
    const row = db
      .prepare(
        `SELECT id, bot_id, child_thread_id, title, goal, status, latest_decision, latest_summary,
                created_at, updated_at, completed_at
           FROM bot_tasks
          WHERE bot_id = ? AND id = ?`,
      )
      .get(botId, taskId) as unknown as RawTaskRow | undefined;
    return row ? mapTaskRow(row) : null;
  };

  const selectTasksByStatuses = (
    botId: string,
    statuses: ReadonlyArray<BotTaskStatus>,
  ): ReadonlyArray<BotTaskRecord> => {
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, bot_id, child_thread_id, title, goal, status, latest_decision, latest_summary,
                created_at, updated_at, completed_at
           FROM bot_tasks
          WHERE bot_id = ? AND status IN (${placeholders})
          ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(botId, ...statuses) as unknown as ReadonlyArray<RawTaskRow>;
    return rows.map(mapTaskRow);
  };

  return {
    sqlitePath,

    getTaskCountsByBot: () =>
      tryOp("getTaskCountsByBot", () => {
        const rows = db
          .prepare("SELECT bot_id, status, COUNT(*) AS cnt FROM bot_tasks GROUP BY bot_id, status")
          .all() as unknown as ReadonlyArray<RawCountRow>;
        const counts = new Map<string, { active: number; completed: number }>();
        for (const row of rows) {
          const current = counts.get(row.bot_id) ?? { active: 0, completed: 0 };
          if (row.status === "active" || row.status === "waiting_user") {
            current.active += Number(row.cnt);
          } else {
            current.completed += Number(row.cnt);
          }
          counts.set(row.bot_id, current);
        }
        return counts;
      }),

    getHome: (botId) => tryOp("getHome", () => selectHome(botId)),

    getProjectIdsByBot: () =>
      tryOp("getProjectIdsByBot", () => {
        const rows = db
          .prepare("SELECT bot_id, project_id FROM bot_homes WHERE project_id IS NOT NULL")
          .all() as unknown as ReadonlyArray<{ bot_id: string; project_id: string }>;
        return new Map(rows.map((row) => [row.bot_id, row.project_id]));
      }),

    upsertHome: Effect.fn("bot.db.upsertHome")(function* (botId, input) {
      const normalizedBotId = botId.trim();
      if (!normalizedBotId) {
        return yield* new BotStoreValidationError({ detail: "botId is required." });
      }
      const now = yield* currentIsoNow;
      return yield* tryOp("upsertHome", () => {
        const existing = selectHome(normalizedBotId);
        const projectId =
          input.projectId !== undefined ? input.projectId : (existing?.projectId ?? null);
        db.prepare(
          `INSERT INTO bot_homes (bot_id, home_thread_id, project_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(bot_id) DO UPDATE SET
             home_thread_id = excluded.home_thread_id,
             project_id = excluded.project_id,
             updated_at = excluded.updated_at`,
        ).run(normalizedBotId, input.homeThreadId, projectId, now);
        return {
          botId: normalizedBotId,
          homeThreadId: input.homeThreadId,
          projectId,
          updatedAt: now,
        } satisfies BotHomeRecord;
      });
    }),

    listActiveTasksForHomeContext: (botId) =>
      tryOp("listActiveTasksForHomeContext", () =>
        selectTasksByStatuses(botId, ["active", "waiting_user"]),
      ),

    listBotTasks: (botId, options) =>
      tryOp("listBotTasks", () => {
        const recentCardsLimit = Math.max(1, Math.min(options?.recentCardsLimit ?? 30, 100));
        const home = selectHome(botId);
        const activeTasks = selectTasksByStatuses(botId, ["active", "waiting_user"]);
        const completedTasks = selectTasksByStatuses(botId, ["completed", "archived"]);
        const cardRows = db
          .prepare(
            `SELECT id, bot_id, task_id, kind, content, created_at
               FROM bot_home_cards
              WHERE bot_id = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT ?`,
          )
          .all(botId, recentCardsLimit) as unknown as ReadonlyArray<RawCardRow>;
        return {
          botId,
          home,
          activeTasks: [...activeTasks],
          completedTasks: [...completedTasks],
          recentCards: cardRows.map(mapCardRow).reverse(),
        } satisfies BotTasksResponse;
      }),

    getTask: (botId, taskId) => tryOp("getTask", () => selectTask(botId, taskId)),

    findTaskByChildThreadId: (childThreadId) =>
      tryOp("findTaskByChildThreadId", () => {
        const row = db
          .prepare(
            `SELECT id, bot_id, child_thread_id, title, goal, status, latest_decision, latest_summary,
                    created_at, updated_at, completed_at
               FROM bot_tasks
              WHERE child_thread_id = ?
              ORDER BY updated_at DESC, rowid DESC
              LIMIT 1`,
          )
          .get(childThreadId) as unknown as RawTaskRow | undefined;
        return row ? mapTaskRow(row) : null;
      }),

    createTask: Effect.fn("bot.db.createTask")(function* (botId, input) {
      const normalizedBotId = botId.trim();
      const title = input.title.trim();
      const goal = (input.goal?.trim() || title).trim();
      if (!normalizedBotId) {
        return yield* new BotStoreValidationError({ detail: "botId is required." });
      }
      if (!title) {
        return yield* new BotStoreValidationError({ detail: "Task title is required." });
      }
      const now = yield* currentIsoNow;
      return yield* tryOp("createTask", () =>
        runInTransaction(db, () => {
          const taskId = NodeCrypto.randomUUID();
          const childThreadId = input.childThreadId ?? null;
          const summary = goal;
          db.prepare(
            `INSERT INTO bot_tasks (
               id, bot_id, child_thread_id, title, goal, status,
               latest_decision, latest_summary, created_at, updated_at, completed_at
             ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL)`,
          ).run(taskId, normalizedBotId, childThreadId, title, goal, summary, now, now);

          const cardId = NodeCrypto.randomUUID();
          const cardContent = `已派发独立任务「${title}」`;
          db.prepare(
            `INSERT INTO bot_home_cards (id, bot_id, task_id, kind, content, created_at)
             VALUES (?, ?, ?, 'task_dispatched', ?, ?)`,
          ).run(cardId, normalizedBotId, taskId, cardContent, now);

          const task: BotTaskRecord = {
            id: taskId,
            botId: normalizedBotId,
            childThreadId,
            title,
            goal,
            status: "active",
            latestDecision: null,
            latestSummary: summary,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };
          const card: BotHomeCardRecord = {
            id: cardId,
            botId: normalizedBotId,
            taskId,
            kind: "task_dispatched",
            content: cardContent,
            createdAt: now,
          };
          return { task, card };
        }),
      );
    }),

    updateTask: Effect.fn("bot.db.updateTask")(function* (botId, taskId, input) {
      if (input.title !== undefined && !input.title.trim()) {
        return yield* new BotStoreValidationError({ detail: "Task title cannot be empty." });
      }
      const existing = yield* tryOp("updateTask.find", () => selectTask(botId, taskId));
      if (!existing) {
        return yield* new BotTaskNotFoundError({ botId, taskId });
      }
      const now = yield* currentIsoNow;
      return yield* tryOp("updateTask.write", () =>
        runInTransaction(db, () => {
          const nextTitle = input.title !== undefined ? input.title.trim() : existing.title;
          const nextGoal = input.goal !== undefined ? input.goal.trim() : existing.goal;
          const nextChildThreadId =
            input.childThreadId !== undefined ? input.childThreadId : existing.childThreadId;
          const nextStatus = input.status ?? existing.status;
          const nextDecision =
            input.latestDecision !== undefined
              ? input.latestDecision?.trim() || null
              : existing.latestDecision;
          const nextSummary =
            input.latestSummary !== undefined
              ? input.latestSummary.trim()
              : nextDecision !== null && nextDecision !== existing.latestDecision
                ? nextDecision
                : existing.latestSummary;
          const nextCompletedAt = isTerminalStatus(nextStatus)
            ? (existing.completedAt ?? now)
            : null;

          db.prepare(
            `UPDATE bot_tasks
                SET title = ?,
                    goal = ?,
                    child_thread_id = ?,
                    status = ?,
                    latest_decision = ?,
                    latest_summary = ?,
                    updated_at = ?,
                    completed_at = ?
              WHERE bot_id = ? AND id = ?`,
          ).run(
            nextTitle,
            nextGoal,
            nextChildThreadId,
            nextStatus,
            nextDecision,
            nextSummary,
            now,
            nextCompletedAt,
            botId,
            taskId,
          );

          const decisionChanged =
            input.latestDecision !== undefined &&
            nextDecision !== null &&
            nextDecision !== existing.latestDecision;
          const statusChanged = input.status !== undefined && nextStatus !== existing.status;

          let card: BotHomeCardRecord | null = null;
          if (input.emitHomeCard !== false && (decisionChanged || statusChanged)) {
            const cardId = NodeCrypto.randomUUID();
            const kind: BotHomeCardKind = decisionChanged ? "task_decision" : "task_status";
            const content = decisionChanged
              ? `「${nextTitle}」结论更新：${nextDecision}`
              : `「${nextTitle}」状态变更：${nextStatus}`;
            db.prepare(
              `INSERT INTO bot_home_cards (id, bot_id, task_id, kind, content, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(cardId, botId, taskId, kind, content, now);
            card = {
              id: cardId,
              botId,
              taskId,
              kind,
              content,
              createdAt: now,
            };
          }

          const task: BotTaskRecord = {
            id: existing.id,
            botId: existing.botId,
            childThreadId: nextChildThreadId,
            title: nextTitle,
            goal: nextGoal,
            status: nextStatus,
            latestDecision: nextDecision,
            latestSummary: nextSummary,
            createdAt: existing.createdAt,
            updatedAt: now,
            completedAt: nextCompletedAt,
          };

          return { task, card };
        }),
      );
    }),

    deleteTask: (botId, taskId) =>
      tryOp("deleteTask", () => {
        const result = db
          .prepare("DELETE FROM bot_tasks WHERE bot_id = ? AND id = ?")
          .run(botId, taskId);
        return Number(result.changes) > 0;
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
