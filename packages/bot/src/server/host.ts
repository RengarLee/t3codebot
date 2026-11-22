import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

export class BotHostError extends Schema.TaggedError<
  BotHostError,
  { readonly brand: unique symbol }
>()("BotHostError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `BotServerHost.${this.operation}: ${this.detail}`;
  }
}

export type BotHostRuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";

export type BotHostInteractionMode = "default" | "plan";

export interface BotHostLaunchThreadInput {
  readonly projectId?: string | undefined;
  readonly title: string;
  readonly initialText?: string | undefined;
  readonly outputSchema?: Readonly<Record<string, Schema.Json>> | undefined;
  readonly runtimeMode?: BotHostRuntimeMode | undefined;
  readonly interactionMode?: BotHostInteractionMode | undefined;
  readonly clientRequestId?: string | undefined;
}

export interface BotHostLaunchThreadResult {
  readonly threadId: string;
  readonly projectId: string;
  readonly resumed: boolean;
}

export interface BotHostSendMessageInput {
  readonly threadId: string;
  readonly text: string;
  /** Starts a clean provider session on the same UI thread (hard anti-pollution reset). */
  readonly freshContext?: boolean | undefined;
  /** Enforces a JSON Schema-validated structured output from the turn. */
  readonly outputSchema?: Readonly<Record<string, Schema.Json>> | undefined;
  readonly deliveryIntent?: "auto" | "steer" | "restart" | undefined;
  readonly clientRequestId?: string | undefined;
}

export interface BotHostSendMessageResult {
  readonly threadId: string;
  readonly messageId: string;
  readonly sequence: number;
}

export interface BotHostThreadLatestResult {
  readonly threadId: string;
  readonly latestRunStatus: string | null;
  readonly latestAssistantText: string | null;
  readonly latestOutput: unknown | null;
}

export type BotHostThreadLifecycleEvent =
  | {
      readonly type: "run_status";
      readonly threadId: string;
      readonly runId: string;
      readonly status: "running" | "waiting" | "completed" | "failed" | "interrupted" | "cancelled";
    }
  | {
      readonly type: "run_output";
      readonly threadId: string;
      readonly runId: string;
      readonly output: unknown;
    }
  | {
      readonly type: "runtime_request_pending";
      readonly threadId: string;
      readonly requestId: string;
      readonly kind: string;
    };

/**
 * Narrow orchestration surface exposed by the T3 Code server host to `@t3tools/bot`.
 * Keeps `@t3tools/bot` independent of `apps/server/src/*` internals so migrating into
 * T3's native plugin host only swaps `apps/server/src/botHostAdapter.ts`.
 */
export interface BotHostOrchestrationShape {
  readonly launchThread: (
    input: BotHostLaunchThreadInput,
  ) => Effect.Effect<BotHostLaunchThreadResult, BotHostError>;
  readonly sendMessage: (
    input: BotHostSendMessageInput,
  ) => Effect.Effect<BotHostSendMessageResult, BotHostError>;
  readonly readLatestResult: (
    threadId: string,
  ) => Effect.Effect<BotHostThreadLatestResult | null, BotHostError>;
  readonly subscribeThreadEvents: () => Stream.Stream<BotHostThreadLifecycleEvent, BotHostError>;
}

export interface BotServerHostShape {
  readonly stateDir: string;
  readonly orchestration?: BotHostOrchestrationShape | undefined;
}

/**
 * Thin host adapter for `@t3tools/bot` server routes and workers.
 */
export class BotServerHost extends Context.Service<BotServerHost, BotServerHostShape>()(
  "@t3tools/bot/server/host/BotServerHost",
) {}
