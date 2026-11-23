import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { BotSessionReceiptSchema, type BotSessionReceipt } from "../contracts.ts";
import type { BotStoreShape } from "./db.ts";
import type { BotHostOrchestrationShape, BotHostThreadLifecycleEvent } from "./host.ts";

const decodeReceipt = Schema.decodeUnknownOption(BotSessionReceiptSchema);

export interface BotSessionSyncDeps {
  readonly store: BotStoreShape;
  readonly orchestration: BotHostOrchestrationShape;
}

function formatReceiptForHome(title: string, receipt: BotSessionReceipt): string {
  const artifacts =
    receipt.artifacts.length > 0 ? `\nArtifacts: ${receipt.artifacts.join(", ")}` : "";
  return `Session receipt from "${title}": ${receipt.status}.\n${receipt.outcome}${artifacts}`;
}

/**
 * A session in a bot's project handed back output. Only a valid receipt is recorded and
 * passed to the bot's Home, which is woken to report it.
 */
export const applyThreadLifecycleEvent = Effect.fn("bot.eventSync.applyEvent")(function* (
  deps: BotSessionSyncDeps,
  event: BotHostThreadLifecycleEvent,
) {
  if (event.type !== "run_output") return false;
  const receipt = decodeReceipt(event.output);
  if (receipt._tag === "None") return false;
  const thread = yield* deps.orchestration.getThread(event.threadId);
  if (thread === null) return false;
  const homes = yield* deps.store.getHomesByBot();
  const owner = [...homes].find(([, home]) => home.projectId === thread.projectId);
  if (owner === undefined) return false;
  const [botId, home] = owner;
  if (home.homeThreadId === null || event.threadId === home.homeThreadId) return false;

  yield* deps.store.upsertSessionReceipt(botId, event.threadId, receipt.value);
  yield* deps.orchestration.sendMessage({
    threadId: home.homeThreadId,
    text: formatReceiptForHome(thread.title, receipt.value),
    // One delivery per session run, even if the event is replayed.
    clientRequestId: `bot:receipt:${event.runId}`,
  });
  return true;
});

/** A scoped fiber, so disabling or reloading the bot module stops it. */
export function startBotEventSyncWorker(deps: BotSessionSyncDeps) {
  return deps.orchestration.subscribeThreadEvents().pipe(
    Stream.runForEach((event) =>
      applyThreadLifecycleEvent(deps, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("bot session receipt failed", { threadId: event.threadId, cause }),
        ),
      ),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
}
