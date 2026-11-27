import {
  AuthSessionId,
  EventId,
  RunId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";

import { ServerAuthMissingCredentialError } from "./auth/EnvironmentAuth.ts";
import {
  makeBotRequestAuthorizer,
  mapDomainEvent,
  readBotSessionRows,
  toHostThreadMessages,
} from "./botHostAdapter.ts";

const message = (fields: Record<string, unknown>) =>
  ({ streaming: false, ...fields }) as unknown as OrchestrationV2ConversationMessage;

describe("bot host adapter", () => {
  it.effect(
    "reads cross-project creation chains, preserves the original sender, and pages history",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, created_at TEXT, deleted_at TEXT, payload_json TEXT)`;
        yield* sql`CREATE TABLE orchestration_v2_projection_runs (thread_id TEXT, ordinal INTEGER, payload_json TEXT)`;
        yield* sql`CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, payload_json TEXT)`;
        yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES
        ('a','bot-a','01',NULL,'{"createdBy":"agent"}'),
        ('b','bot-b','02',NULL,'{"createdBy":"agent"}'),
        ('native','bot-b','03',NULL,'{"lineage":{"parentThreadId":"b"}}'),
        ('unrelated','other-project','04',NULL,'{"lineage":{"parentThreadId":"home"}}'),
        ('person','bot-a','05',NULL,'{"createdBy":"user"}'),
        ('deleted','bot-a','06','07','{"lineage":{"parentThreadId":"home"}}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_runs VALUES
        ('a',0,'{"userMessageId":"m1"}'),('a',1,'{"userMessageId":"m2"}'),
        ('b',0,'{"userMessageId":"m3"}'),('person',0,'{"userMessageId":"m1"}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES
        ('m1','{"senderThreadId":"home"}'),('m2','{"senderThreadId":"other-sender"}'),('m3','{"senderThreadId":"a"}')`;
        const input = {
          parentThreadId: ThreadId.make("home"),
          descendants: false,
          projectIds: ["bot-a", "bot-b"],
        };
        expect((yield* readBotSessionRows(input)).rows.map((row) => row.thread_id)).toEqual(["a"]);
        expect(
          (yield* readBotSessionRows({ ...input, descendants: true })).rows.map((row) => [
            row.thread_id,
            row.parent_id,
          ]),
        ).toEqual([
          ["a", "home"],
          ["b", "a"],
          ["native", "b"],
        ]);
        yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES ('missing-first','bot-a','08',NULL,'{"createdBy":"agent"}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_runs VALUES ('missing-first',0,'{"userMessageId":"missing"}'),('missing-first',1,'{"userMessageId":"m1"}')`;
        expect((yield* readBotSessionRows(input)).rows.map((row) => row.thread_id)).toEqual(["a"]);
        for (let index = 0; index < 42; index++) {
          yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES (${`history-${index.toString().padStart(2, "0")}`},'bot-a','10',NULL,'{"lineage":{"parentThreadId":"home"}}')`;
        }
        const first = yield* readBotSessionRows(input);
        expect(first.hasMore).toBe(true);
        expect(first.rows).toHaveLength(40);
        const last = first.rows.at(-1);
        if (last === undefined) throw new Error("Expected a history cursor");
        const next = yield* readBotSessionRows({
          ...input,
          cursor: { createdAt: last.created_at, threadId: ThreadId.make(last.thread_id) },
        });
        expect(next.hasMore).toBe(false);
        expect(next.rows.map((row) => row.thread_id)).toEqual(["history-01", "history-00", "a"]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  it("hands the bot a run's submitted output value, not T3's output envelope", () => {
    const receipt = { status: "done", outcome: "Created bye.md.", artifacts: ["notes/bye.md"] };
    expect(
      mapDomainEvent({
        id: EventId.make("event-1"),
        threadId: ThreadId.make("thread-1"),
        occurredAt: DateTime.makeUnsafe("2026-11-23T00:00:00.000Z"),
        type: "run.output-submitted",
        payload: {
          runId: RunId.make("run-1"),
          output: { value: receipt, submittedAt: "2026-11-23T00:00:00.000Z" },
        },
      }),
    ).toEqual({ type: "run_output", threadId: "thread-1", runId: "run-1", output: receipt });
  });

  it("reads a thread as the chat a person sees: finished user and assistant text, in order", () => {
    expect(
      toHostThreadMessages([
        message({ id: "m1", role: "user", text: "Fix it", createdBy: "user" }),
        message({ id: "m2", role: "system", text: "Context", createdBy: "agent" }),
        message({ id: "m3", role: "assistant", text: "Working", createdBy: "agent" }),
        message({ id: "m4", role: "assistant", text: "   ", createdBy: "agent" }),
        message({
          id: "m5",
          role: "assistant",
          text: "Partial",
          createdBy: "agent",
          streaming: true,
        }),
        message({ id: "m6", role: "user", text: "Task from Home", createdBy: "agent" }),
        message({ id: "m7", role: "user", text: "Unknown author" }),
      ]),
    ).toEqual([
      { id: "m1", role: "user", text: "Fix it", createdBy: "user" },
      { id: "m3", role: "assistant", text: "Working", createdBy: "agent" },
      { id: "m6", role: "user", text: "Task from Home", createdBy: "agent" },
      { id: "m7", role: "user", text: "Unknown author", createdBy: null },
    ]);
  });
  it.effect("lets bot requests through only with the server's credential and scope", () =>
    Effect.gen(function* () {
      const authorize = makeBotRequestAuthorizer({
        authenticateHttpRequest: (request) =>
          request.headers.authorization === "Bearer reader"
            ? Effect.succeed({
                sessionId: AuthSessionId.make("session-reader"),
                subject: "reader",
                method: "bearer-access-token",
                scopes: ["orchestration:read"],
              })
            : Effect.fail(new ServerAuthMissingCredentialError({})),
      });
      const request = (headers: Record<string, string>) =>
        HttpServerRequest.fromWeb(new Request("http://localhost/api/bots/list", { headers }));
      const statusOf = (access: ReturnType<typeof authorize>) =>
        access.pipe(Effect.match({ onSuccess: () => 200, onFailure: (error) => error.status }));

      expect(yield* statusOf(authorize(request({}), "read"))).toBe(401);
      const reader = request({ authorization: "Bearer reader" });
      expect(yield* statusOf(authorize(reader, "read"))).toBe(200);
      expect(yield* statusOf(authorize(reader, "operate"))).toBe(403);
    }),
  );
});
