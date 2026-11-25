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

export interface BotHostEnsureProjectInput {
  readonly workspaceRoot: string;
  readonly title: string;
}

export interface BotHostTrackedFolder {
  readonly path: string;
  readonly name: string;
}

export interface BotHostSyncProjectFoldersInput {
  readonly projectId: string;
  readonly folders: ReadonlyArray<BotHostTrackedFolder>;
}

export interface BotHostUpdateProjectTitleInput {
  readonly projectId: string;
  readonly title: string;
}

export interface BotHostThreadInfo {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
}

export interface BotHostLaunchThreadInput {
  readonly projectId: string;
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

export interface BotHostSendMessageNotification {
  readonly summary: string;
  readonly outcome: "completed" | "updated" | "failed";
  readonly detail?: string | undefined;
}

export interface BotHostSendMessageInput {
  readonly threadId: string;
  readonly text: string;
  /** Starts a clean provider session on the same UI thread (hard anti-pollution reset). */
  readonly freshContext?: boolean | undefined;
  /** Enforces a JSON Schema-validated structured output from the turn. */
  readonly outputSchema?: Readonly<Record<string, Schema.Json>> | undefined;
  readonly deliveryIntent?: "auto" | "steer" | "restart" | undefined;
  /** Marks the message as a T3 notification wake instead of a user bubble. */
  readonly notification?: BotHostSendMessageNotification | undefined;
  readonly clientRequestId?: string | undefined;
}

export interface BotHostSettleThreadInput {
  readonly threadId: string;
  readonly clientRequestId?: string | undefined;
}

export interface BotHostSendMessageResult {
  readonly threadId: string;
  readonly messageId: string;
  readonly sequence: number;
}

export interface BotHostThreadRunResult {
  readonly threadId: string;
  readonly runId: string;
  readonly isLatestRun: boolean;
  readonly status: string | null;
  readonly createdBy?: "user" | "agent" | null | undefined;
  readonly hasOutputSchema?: boolean | undefined;
  readonly assistantText: string | null;
  readonly output: unknown | null;
}

/** One message of a thread's conversation, in the order the thread shows them. */
export interface BotHostThreadMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  /** Who wrote it: the person, an agent (a dispatched task, say), or unknown. */
  readonly createdBy: "user" | "agent" | null;
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
  /** Returns the live project rooted at `workspaceRoot`, creating it (and the folder) when missing. */
  readonly ensureProject: (
    input: BotHostEnsureProjectInput,
  ) => Effect.Effect<{ readonly projectId: string }, BotHostError>;
  /** Replaces the project's user-added tracked folders so sandboxes grant those roots. */
  readonly syncProjectFolders: (
    input: BotHostSyncProjectFoldersInput,
  ) => Effect.Effect<void, BotHostError>;
  /** Updates the T3 project title when a bot is renamed. */
  readonly updateProjectTitle: (
    input: BotHostUpdateProjectTitleInput,
  ) => Effect.Effect<void, BotHostError>;
  /** Null when the thread is unknown or deleted. */
  readonly getThread: (threadId: string) => Effect.Effect<BotHostThreadInfo | null, BotHostError>;
  readonly launchThread: (
    input: BotHostLaunchThreadInput,
  ) => Effect.Effect<BotHostLaunchThreadResult, BotHostError>;
  readonly sendMessage: (
    input: BotHostSendMessageInput,
  ) => Effect.Effect<BotHostSendMessageResult, BotHostError>;
  readonly settleThread: (input: BotHostSettleThreadInput) => Effect.Effect<void, BotHostError>;
  readonly readRunResult: (
    threadId: string,
    runId: string,
  ) => Effect.Effect<BotHostThreadRunResult | null, BotHostError>;
  /** The thread's conversation in order, or null when the thread is unknown or deleted. */
  readonly readThreadMessages: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<BotHostThreadMessage> | null, BotHostError>;
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
