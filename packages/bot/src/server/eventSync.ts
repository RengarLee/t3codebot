import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { BotTaskStatusSchema, type BotTaskStatus } from "../contracts.ts";
import type { BotStoreShape } from "./db.ts";
import type { BotHostOrchestrationShape, BotHostThreadLifecycleEvent } from "./host.ts";

const StructuredTaskOutcomeSchema = Schema.Struct({
  decision: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  status: Schema.optional(BotTaskStatusSchema),
});

const decodeStructuredOutcome = Schema.decodeUnknownOption(StructuredTaskOutcomeSchema);

function truncateSummary(text: string, maxChars = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

export const applyThreadLifecycleEvent = Effect.fn("bot.eventSync.applyEvent")(function* (
  store: BotStoreShape,
  orchestration: BotHostOrchestrationShape,
  event: BotHostThreadLifecycleEvent,
) {
  const task = yield* store
    .findTaskByChildThreadId(event.threadId)
    .pipe(Effect.orElseSucceed(() => null));
  if (!task) return false;

  if (event.type === "runtime_request_pending") {
    if (task.status === "completed" || task.status === "archived") return false;
    yield* store
      .updateTask(task.botId, task.id, {
        status: "waiting_user",
        latestSummary: `子线程等待确认（${event.kind}）`,
        emitHomeCard: task.status !== "waiting_user",
      })
      .pipe(Effect.ignore);
    return true;
  }

  if (event.type === "run_output") {
    const parsed = decodeStructuredOutcome(event.output);
    if (parsed._tag === "None") return false;
    const outcome = parsed.value;
    const decision = outcome.decision?.trim();
    const summary = outcome.summary?.trim();
    const nextStatus: BotTaskStatus | undefined = outcome.status;
    if (!decision && !summary && nextStatus === undefined) return false;

    yield* store
      .updateTask(task.botId, task.id, {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(decision ? { latestDecision: decision } : {}),
        ...(summary ? { latestSummary: truncateSummary(summary) } : {}),
        emitHomeCard: true,
      })
      .pipe(Effect.ignore);
    return true;
  }

  // event.type === "run_status"
  if (event.status === "failed") {
    if (task.status === "completed" || task.status === "archived") return false;
    yield* store
      .updateTask(task.botId, task.id, {
        status: "waiting_user",
        latestSummary: "子线程执行失败，等待检查或重试",
        emitHomeCard: true,
      })
      .pipe(Effect.ignore);
    return true;
  }

  if (event.status === "completed" && task.status === "active") {
    const latest = yield* orchestration
      .readLatestResult(event.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const latestText = latest?.latestAssistantText?.trim();
    if (latestText) {
      yield* store
        .updateTask(task.botId, task.id, {
          latestSummary: truncateSummary(latestText),
          emitHomeCard: false,
        })
        .pipe(Effect.ignore);
      return true;
    }
  }

  return false;
});

/**
 * Starts a cleanly disposable scoped background fiber that listens to T3 orchestration
 * thread lifecycle events and keeps `bots.sqlite` task states automatically synchronized.
 */
export function startBotEventSyncWorker(
  store: BotStoreShape,
  orchestration: BotHostOrchestrationShape,
): Effect.Effect<Fiber.Fiber<void, never>, never, Scope.Scope> {
  return orchestration.subscribeThreadEvents().pipe(
    Stream.runForEach((event) => applyThreadLifecycleEvent(store, orchestration, event)),
    Effect.ignore,
    Effect.forkScoped,
  );
}
