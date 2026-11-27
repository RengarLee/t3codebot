import {
  BotHostAuthError,
  BotHostError,
  BotServerHost,
  type BotRequestAccess,
  type BotHostOrchestrationShape,
  type BotHostThreadLifecycleEvent,
  type BotHostThreadMessage,
} from "@t3tools/bot/server/host";
import { botHttpRoutesLayer } from "@t3tools/bot/server/http";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import type { HttpServerRequest } from "effect/http";
import type { BotSessionsRequest } from "@t3tools/bot/contracts";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServerConfig from "./config.ts";
import * as OrchestratorV2 from "./orchestration-v2/Orchestrator.ts";
import * as ProjectStoreV2 from "./orchestration-v2/ProjectStore.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProjectionStoreV2 from "./orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunchService from "./orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "./provider/ProviderRegistry.ts";

function toHostError(operation: string, cause: unknown): BotHostError {
  return new BotHostError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

export const readBotSessionRows = Effect.fn("botHostAdapter.readSessionRows")(function* (
  input: BotSessionsRequest & { readonly projectIds: ReadonlyArray<string> },
) {
  const sql = yield* SqlClient.SqlClient;
  // The first run's sender survives later messages; forks/subagents already have native lineage.
  const rows = yield* sql<{
    readonly thread_id: string;
    readonly parent_id: string;
    readonly created_at: string;
  }>`
    WITH RECURSIVE sessions AS MATERIALIZED (
      SELECT t.thread_id, t.created_at,
        COALESCE(json_extract(t.payload_json, '$.lineage.parentThreadId'),
          CASE WHEN json_extract(t.payload_json, '$.createdBy') = 'agent' THEN (
            SELECT json_extract(m.payload_json, '$.senderThreadId')
            FROM orchestration_v2_projection_messages m
            WHERE m.message_id = (
              SELECT json_extract(r.payload_json, '$.userMessageId')
              FROM orchestration_v2_projection_runs r
              WHERE r.thread_id = t.thread_id
              ORDER BY r.ordinal LIMIT 1
            )
          ) END) AS parent_id
      FROM orchestration_v2_projection_threads t
      WHERE t.deleted_at IS NULL
        AND t.project_id IN ${sql.in(input.projectIds)}
    ), descendants(thread_id) AS (
      SELECT thread_id FROM sessions WHERE parent_id = ${input.parentThreadId}
      UNION
      SELECT s.thread_id FROM sessions s JOIN descendants d ON s.parent_id = d.thread_id
      WHERE ${input.descendants ? 1 : 0} = 1 AND s.thread_id != ${input.parentThreadId}
    )
    SELECT s.thread_id, s.parent_id, s.created_at
    FROM sessions s JOIN descendants d ON s.thread_id = d.thread_id
    WHERE s.thread_id != ${input.parentThreadId}
      ${
        input.cursor === undefined
          ? sql``
          : input.descendants
            ? sql`AND (s.created_at, s.thread_id) > (${input.cursor.createdAt}, ${input.cursor.threadId})`
            : sql`AND (s.created_at, s.thread_id) < (${input.cursor.createdAt}, ${input.cursor.threadId})`
      }
    ORDER BY s.created_at ${input.descendants ? sql`ASC` : sql`DESC`}, s.thread_id ${input.descendants ? sql`ASC` : sql`DESC`}
    LIMIT 41
  `;
  return { rows: rows.slice(0, 40), hasMore: rows.length > 40 };
});

function mapRunStatus(
  status: string,
): Extract<BotHostThreadLifecycleEvent, { readonly type: "run_status" }>["status"] | null {
  switch (status) {
    case "running":
    case "waiting":
    case "completed":
    case "failed":
    case "interrupted":
    case "cancelled":
      return status;
    default:
      return null;
  }
}

export function mapDomainEvent(
  event: OrchestrationV2DomainEvent,
): BotHostThreadLifecycleEvent | null {
  if (event.type === "run.updated") {
    const status = mapRunStatus(event.payload.status);
    if (status === null) return null;
    return {
      type: "run_status",
      threadId: event.threadId,
      runId: event.payload.id,
      status,
    };
  }
  if (event.type === "run.output-submitted") {
    return {
      type: "run_output",
      threadId: event.threadId,
      runId: event.payload.runId,
      output: event.payload.output.value,
    };
  }
  if (event.type === "runtime-request.updated" && event.payload.status === "pending") {
    return {
      type: "runtime_request_pending",
      threadId: event.threadId,
      requestId: event.payload.id,
      kind: event.payload.kind,
    };
  }
  return null;
}

/** The chat a person would read: user and assistant text that is finished, in thread order. */
export function toHostThreadMessages(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): ReadonlyArray<BotHostThreadMessage> {
  return messages.flatMap((message) =>
    (message.role === "user" || message.role === "assistant") &&
    !message.streaming &&
    message.text.trim().length > 0
      ? [
          {
            id: message.id,
            role: message.role,
            text: message.text,
            createdBy:
              message.createdBy === "user" || message.createdBy === "agent"
                ? message.createdBy
                : null,
          },
        ]
      : [],
  );
}

const BOT_ACCESS_SCOPES = {
  read: AuthOrchestrationReadScope,
  operate: AuthOrchestrationOperateScope,
} as const;

/** Bot routes take the same credentials and scopes as the server's own orchestration routes. */
export const makeBotRequestAuthorizer = (
  auth: Pick<EnvironmentAuth.EnvironmentAuth["Service"], "authenticateHttpRequest">,
) =>
  Effect.fn("botHostAdapter.authorize")(function* (
    request: HttpServerRequest.HttpServerRequest,
    access: BotRequestAccess,
  ) {
    const session = yield* auth.authenticateHttpRequest(request).pipe(
      Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, Effect.die),
      Effect.mapError((error) => new BotHostAuthError({ status: 401, detail: error.message })),
    );
    const scope = BOT_ACCESS_SCOPES[access];
    if (!session.scopes.includes(scope)) {
      return yield* new BotHostAuthError({
        status: 403,
        detail: `This client's session lacks the ${scope} scope.`,
      });
    }
  });

const layerBotServerHostLive = Layer.effect(
  BotServerHost,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const orchestrator = yield* OrchestratorV2.OrchestratorV2;
    const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
    const projections = yield* ProjectionStoreV2.ProjectionStoreV2;
    const projectStore = yield* ProjectStoreV2.ProjectStoreV2;
    const projectService = yield* ProjectService.ProjectService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const random = yield* SecureRandom.SecureRandom;
    const sql = yield* SqlClient.SqlClient;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;

    const resolveFallbackModelSelection = Effect.gen(function* () {
      const providers = yield* providerRegistry.getProviders;
      const available =
        providers.find((provider) => provider.enabled && provider.models.length > 0) ??
        providers.find((provider) => provider.models.length > 0);
      const firstModel = available?.models[0];
      if (!available || !firstModel) {
        return yield* new BotHostError({
          operation: "launchThread",
          detail: "No enabled provider model is available to launch a bot thread.",
        });
      }
      return {
        instanceId: available.instanceId,
        model: firstModel.slug,
      } satisfies ModelSelection;
    });

    const orchestration: BotHostOrchestrationShape = {
      readSessions: Effect.fn("botHostAdapter.readSessions")(function* (input) {
        const { rows, hasMore } = yield* readBotSessionRows(input).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError((cause) => toHostError("readSessions", cause)),
        );
        const sessions = yield* Effect.forEach(rows, (row) =>
          projections.getThreadShell(ThreadId.make(row.thread_id)).pipe(
            Effect.map((thread) =>
              thread === null ? [] : [{ parentThreadId: ThreadId.make(row.parent_id), thread }],
            ),
            Effect.mapError((cause) => toHostError("readSessions", cause)),
          ),
        );
        return { sessions: sessions.flat(), hasMore };
      }),
      ensureProject: Effect.fn("botHostAdapter.ensureProject")(function* (input) {
        const { project } = yield* projectService
          .bootstrap({
            commandId: CommandId.make(`bot:project:${yield* random.uuidV4()}`),
            projectId: ProjectId.make(yield* random.uuidV4()),
            title: input.title,
            workspaceRoot: input.workspaceRoot,
            createWorkspaceRootIfMissing: true,
          })
          .pipe(Effect.mapError((cause) => toHostError("ensureProject", cause)));
        return { projectId: project.id };
      }),

      syncProjectFolders: Effect.fn("botHostAdapter.syncProjectFolders")(function* (input) {
        yield* projectService
          .update({
            commandId: CommandId.make(`bot:folders:${yield* random.uuidV4()}`),
            projectId: ProjectId.make(input.projectId),
            trackedFolders: input.folders,
          })
          .pipe(Effect.mapError((cause) => toHostError("syncProjectFolders", cause)));
      }),

      updateProjectTitle: Effect.fn("botHostAdapter.updateProjectTitle")(function* (input) {
        yield* projectService
          .update({
            commandId: CommandId.make(`bot:rename:${yield* random.uuidV4()}`),
            projectId: ProjectId.make(input.projectId),
            title: input.title,
          })
          .pipe(Effect.mapError((cause) => toHostError("updateProjectTitle", cause)));
      }),

      getThread: Effect.fn("botHostAdapter.getThread")(function* (threadId) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(threadId), [])
          .pipe(Effect.option);
        if (records._tag === "None" || records.value.thread.deletedAt !== null) return null;
        return {
          threadId,
          projectId: records.value.thread.projectId,
          title: records.value.thread.title,
        };
      }),

      launchThread: Effect.fn("botHostAdapter.launchThread")(function* (input) {
        const project = Option.getOrUndefined(
          yield* projectStore
            .get(ProjectId.make(input.projectId))
            .pipe(Effect.mapError((cause) => toHostError("launchThread.getProject", cause))),
        );
        if (!project) {
          return yield* new BotHostError({
            operation: "launchThread",
            detail: `Project not found: ${input.projectId}`,
          });
        }

        const modelSelection =
          project.defaultModelSelection ?? (yield* resolveFallbackModelSelection);
        const commandId = CommandId.make(
          input.clientRequestId?.trim() || `bot:launch:${yield* random.uuidV4()}`,
        );

        const launched = yield* threadLaunch
          .launch({
            commandId,
            projectId: project.projectId,
            title: input.title,
            modelSelection,
            runtimeMode: input.runtimeMode ?? "auto",
            interactionMode: input.interactionMode ?? "default",
            workspaceStrategy: { type: "root" },
            ...(input.initialText !== undefined
              ? {
                  initialMessage: {
                    text: input.initialText,
                    attachments: [],
                    ...(input.outputSchema !== undefined
                      ? { outputSchema: input.outputSchema }
                      : {}),
                  },
                }
              : {}),
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(Effect.mapError((cause) => toHostError("launchThread", cause)));

        return {
          threadId: launched.threadId,
          projectId: project.projectId,
          resumed: launched.resumed,
        };
      }),

      sendMessage: Effect.fn("botHostAdapter.sendMessage")(function* (input) {
        const commandId = CommandId.make(
          input.clientRequestId?.trim() || `bot:send:${yield* random.uuidV4()}`,
        );
        const messageId = MessageId.make(`bot:msg:${yield* random.uuidV4()}`);
        const threadId = ThreadId.make(input.threadId);

        const result = yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId,
            threadId,
            messageId,
            text: input.text,
            attachments: [],
            ...(input.freshContext ? { freshContext: true } : {}),
            ...(input.outputSchema !== undefined ? { outputSchema: input.outputSchema } : {}),
            ...(input.deliveryIntent !== undefined ? { deliveryIntent: input.deliveryIntent } : {}),
            ...(input.notification !== undefined
              ? {
                  notification: {
                    source: { kind: "background_task" as const },
                    outcome: input.notification.outcome,
                    summary: input.notification.summary.trim() || "Bot update",
                    ...(input.notification.detail !== undefined
                      ? { detail: input.notification.detail }
                      : {}),
                  },
                }
              : {}),
            dispatchMode: { type: "queue_after_active" },
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(Effect.mapError((cause) => toHostError("sendMessage", cause)));

        return {
          threadId: input.threadId,
          messageId,
          sequence: result.sequence,
        };
      }),

      settleThread: Effect.fn("botHostAdapter.settleThread")(function* (input) {
        const commandId = CommandId.make(
          input.clientRequestId?.trim() || `bot:settle:${yield* random.uuidV4()}`,
        );
        yield* orchestrator
          .dispatch({
            type: "thread.settle",
            commandId,
            threadId: ThreadId.make(input.threadId),
          })
          .pipe(Effect.mapError((cause) => toHostError("settleThread", cause)));
      }),

      readRunResult: Effect.fn("botHostAdapter.readRunResult")(function* (threadId, runId) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(threadId), ["runs", "messages"], {
            runIds: [RunId.make(runId)],
            messageRunIds: [RunId.make(runId)],
          })
          .pipe(
            Effect.mapError((cause) => toHostError("readRunResult", cause)),
            Effect.option,
          );
        if (records._tag === "None") return null;

        const run = records.value.runs.find((run) => run.id === runId);
        if (run === undefined) return null;
        const latest = yield* projections
          .getThreadRecords(ThreadId.make(threadId), ["runs"], { includeLatestRun: true })
          .pipe(Effect.mapError((cause) => toHostError("readRunResult", cause)));
        const runUserMessage = records.value.messages.find(
          (message) => message.id === run.userMessageId,
        );
        const assistant = [...records.value.messages]
          .reverse()
          .find((message) => message.role === "assistant" && message.text.trim().length > 0);

        return {
          threadId,
          runId: run.id,
          isLatestRun: latest.runs.every((candidate) => candidate.ordinal <= run.ordinal),
          status: run.status,
          createdBy:
            runUserMessage?.createdBy === "user" || runUserMessage?.createdBy === "agent"
              ? runUserMessage.createdBy
              : null,
          hasOutputSchema: run.outputSchema !== undefined,
          assistantText: assistant?.text ?? null,
          output: run.output?.value ?? null,
        };
      }),

      readThreadMessages: Effect.fn("botHostAdapter.readThreadMessages")(function* (threadId) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(threadId), ["messages"])
          .pipe(Effect.option);
        if (records._tag === "None" || records.value.thread.deletedAt !== null) return null;
        return toHostThreadMessages(records.value.messages);
      }),

      subscribeThreadEvents: () =>
        orchestrator.streamDomainEvents.pipe(
          Stream.mapError((cause) => toHostError("subscribeThreadEvents", cause)),
          Stream.filterMap((event) => {
            const mapped = mapDomainEvent(event);
            return mapped === null ? Result.failVoid : Result.succeed(mapped);
          }),
        ),
    };

    return {
      stateDir: config.stateDir,
      orchestration,
      authorize: makeBotRequestAuthorizer(auth),
    };
  }),
);

/**
 * Single server mount point wired in `apps/server/src/server.ts`.
 * Provides T3 Code's orchestration primitives through the narrow `BotServerHost` adapter.
 */
export const botServerRoutesLayer = botHttpRoutesLayer.pipe(
  Layer.provide(layerBotServerHostLive),
  Layer.provide(ProjectionStoreV2.layer),
  Layer.provide(ProjectStoreV2.layer),
);
