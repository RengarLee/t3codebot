import {
  BotHostError,
  BotServerHost,
  type BotHostOrchestrationShape,
  type BotHostThreadLifecycleEvent,
} from "@t3tools/bot/server/host";
import { botHttpRoutesLayer } from "@t3tools/bot/server/http";
import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type ModelSelection,
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

function mapDomainEvent(event: OrchestrationV2DomainEvent): BotHostThreadLifecycleEvent | null {
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
      output: event.payload.output,
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

      getThread: Effect.fn("botHostAdapter.getThread")(function* (threadId) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(threadId), [])
          .pipe(Effect.option);
        if (records._tag === "None" || records.value.thread.deletedAt !== null) return null;
        return { threadId, projectId: records.value.thread.projectId };
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

      readLatestResult: Effect.fn("botHostAdapter.readLatestResult")(function* (threadId) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(threadId), ["runs", "messages"], {
            includeLatestRun: true,
          })
          .pipe(
            Effect.mapError((cause) => toHostError("readLatestResult", cause)),
            Effect.option,
          );
        if (records._tag === "None") return null;

        const latestRun = records.value.runs.reduce<
          (typeof records.value.runs)[number] | undefined
        >(
          (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
          undefined,
        );
        const latestAssistant = [...records.value.messages]
          .reverse()
          .find((message) => message.role === "assistant" && message.text.trim().length > 0);

        return {
          threadId,
          latestRunStatus: latestRun?.status ?? null,
          latestAssistantText: latestAssistant?.text ?? null,
          latestOutput: latestRun?.output ?? null,
        };
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
