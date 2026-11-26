import {
  BotHostError,
  BotServerHost,
  type BotHostOrchestrationShape,
  type BotHostThreadLifecycleEvent,
  type BotHostThreadMessage,
} from "@t3tools/bot/server/host";
import { botHttpRoutesLayer } from "@t3tools/bot/server/http";
import {
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
