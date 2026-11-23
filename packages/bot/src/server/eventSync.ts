import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  BotSessionReceiptSchema,
  BotSubBotSpecSchema,
  MAIN_BOT_ID,
  type BotSessionReceipt,
} from "../contracts.ts";
import type { BotHomeDeps } from "./home.ts";
import type { BotHostThreadLifecycleEvent } from "./host.ts";
import { listStateDirBots, writeFileIfChanged } from "./registry.ts";
import { resolveBotStoragePaths } from "./storage.ts";
import { createSubBot } from "./subBots.ts";
import { renderSessionLog } from "./template.ts";

const decodeReceipt = Schema.decodeUnknownOption(BotSessionReceiptSchema);
const decodeSubBotSpec = Schema.decodeUnknownOption(BotSubBotSpecSchema);

function formatReceiptForHome(
  title: string,
  subBotName: string | null,
  receipt: BotSessionReceipt,
): string {
  const from = subBotName === null ? `"${title}"` : `"${title}" (sub-bot "${subBotName}")`;
  const artifacts =
    receipt.artifacts.length > 0 ? `\nArtifacts: ${receipt.artifacts.join(", ")}` : "";
  return `Session receipt from ${from}: ${receipt.status}.\n${receipt.outcome}${artifacts}`;
}

const SESSION_LOG_LIMIT = 30;

/** Rewrites the main bot's `SESSIONS.md` from its receipts, with titles read live from T3. */
const writeSessionLog = Effect.fn("bot.eventSync.writeSessionLog")(function* (deps: BotHomeDeps) {
  const path = yield* Path.Path;
  const receipts = (yield* deps.store.listSessionReceipts(MAIN_BOT_ID)).slice(0, SESSION_LOG_LIMIT);
  const entries = yield* Effect.forEach(receipts, (receipt) =>
    deps.orchestration
      .getThread(receipt.threadId)
      .pipe(Effect.map((thread) => ({ ...receipt, title: thread?.title ?? "(deleted)" }))),
  );
  const { directory } = yield* resolveBotStoragePaths(deps.stateDir);
  yield* writeFileIfChanged(
    path.join(directory, MAIN_BOT_ID, "workspace", "SESSIONS.md"),
    renderSessionLog(entries),
  );
});

/**
 * A session in any bot's project handed back output. A valid receipt is recorded and passed to
 * the main bot's Home, the only one the user talks to. A sub-bot spec from a session in the main
 * bot's project creates that sub-bot. Either way Home is woken to report it.
 */
export const applyThreadLifecycleEvent = Effect.fn("bot.eventSync.applyEvent")(function* (
  deps: BotHomeDeps,
  event: BotHostThreadLifecycleEvent,
) {
  if (event.type !== "run_output") return false;
  const receipt = decodeReceipt(event.output);
  const spec = receipt._tag === "None" ? decodeSubBotSpec(event.output) : undefined;
  if (receipt._tag === "None" && spec?._tag !== "Some") return false;

  const thread = yield* deps.orchestration.getThread(event.threadId);
  if (thread === null) return false;
  const homes = yield* deps.store.getHomesByBot();
  const owner = [...homes].find(([, home]) => home.projectId === thread.projectId);
  const homeThreadId = homes.get(MAIN_BOT_ID)?.homeThreadId ?? null;
  if (owner === undefined || homeThreadId === null || event.threadId === homeThreadId) {
    return false;
  }
  const [ownerId] = owner;

  if (receipt._tag === "Some") {
    yield* deps.store.upsertSessionReceipt(ownerId, event.threadId, receipt.value);
    if (ownerId === MAIN_BOT_ID) yield* writeSessionLog(deps);
    const subBotName =
      ownerId === MAIN_BOT_ID
        ? null
        : ((yield* listStateDirBots(deps.stateDir)).bots.find((bot) => bot.id === ownerId)?.name ??
          ownerId);
    yield* deps.orchestration.sendMessage({
      threadId: homeThreadId,
      text: formatReceiptForHome(thread.title, subBotName, receipt.value),
      // One delivery per session run, even if the event is replayed.
      clientRequestId: `bot:receipt:${event.runId}`,
    });
    return true;
  }

  if (ownerId !== MAIN_BOT_ID || spec?._tag !== "Some") return false;
  const created = yield* createSubBot(deps, spec.value).pipe(
    Effect.map(({ bot, projectId }) => ({
      text: `Sub-bot created: "${bot.name}" (projectId ${projectId}). ${bot.summary}`,
    })),
    Effect.catch((error) =>
      Effect.succeed({ text: `Sub-bot "${spec.value.name}" was not created: ${error.message}` }),
    ),
  );
  yield* deps.orchestration.sendMessage({
    threadId: homeThreadId,
    text: created.text,
    clientRequestId: `bot:sub-bot:${event.runId}`,
  });
  return true;
});

/** A scoped fiber, so disabling or reloading the bot module stops it. */
export function startBotEventSyncWorker(deps: BotHomeDeps) {
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
