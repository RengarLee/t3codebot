import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  BOT_WAKE_NOTIFICATION_DETAIL,
  BotSessionReceiptSchema,
  BotSubBotSpecSchema,
  BotWorkingFoldersUpdateSchema,
  MAIN_BOT_ID,
  SKILL_REVIEW_TITLE_PREFIX,
  type BotSessionReceipt,
} from "../contracts.ts";
import type { BotHomeDeps } from "./home.ts";
import type { BotHostThreadLifecycleEvent } from "./host.ts";
import { writeFileIfChanged } from "./registry.ts";
import { reconcileScopes } from "./skillReconciler.ts";
import type { SkillReviewService } from "./skillReview.ts";
import { resolveBotStoragePaths } from "./storage.ts";
import { createSubBot } from "./subBots.ts";
import { renderSessionLog } from "./template.ts";
import { applyBotWorkingFoldersUpdate } from "./workingFolders.ts";

const decodeReceipt = Schema.decodeUnknownOption(BotSessionReceiptSchema);
const decodeSubBotSpec = Schema.decodeUnknownOption(BotSubBotSpecSchema);
const decodeWorkingFoldersUpdate = Schema.decodeUnknownOption(BotWorkingFoldersUpdateSchema);

const MAX_HOME_RECEIPT_OUTCOME_CHARS = 240;
const MAX_HOME_RECEIPT_ARTIFACTS = 3;

function formatSessionLink(threadId: string, title: string): string {
  const safeTitle = title.replaceAll(/\r?\n/g, " ").replaceAll("[", "(").replaceAll("]", ")");
  return `[${safeTitle}](t3-thread://v1/${threadId})`;
}

function compactTextForHome(raw: string): { readonly text: string; readonly truncated: boolean } {
  const normalized = raw.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= MAX_HOME_RECEIPT_OUTCOME_CHARS) {
    return { text: normalized, truncated: false };
  }
  const clipped = normalized.slice(0, MAX_HOME_RECEIPT_OUTCOME_CHARS - 1).trimEnd();
  return { text: `${clipped}…`, truncated: true };
}

function formatArtifactLabel(rawArtifact: string): string {
  const artifact = rawArtifact.trim();
  if (/^https?:\/\//i.test(artifact)) return artifact;
  const isAbsolutePath = /^(?:[A-Za-z]:[\\/]|\/)/.test(artifact);
  if (!isAbsolutePath && artifact.length <= 48) return artifact;
  const segments = artifact.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? artifact;
}

function formatReceiptForHome(threadId: string, title: string, receipt: BotSessionReceipt): string {
  const link = formatSessionLink(threadId, title);
  const { text: summary, truncated } = compactTextForHome(receipt.outcome);
  const lines = [`Session finished (${receipt.status}): ${link}`];
  if (summary.length > 0) {
    lines.push(truncated ? `${summary} (full details in session)` : summary);
  }
  if (receipt.artifacts.length > 0) {
    const shown = receipt.artifacts.slice(0, MAX_HOME_RECEIPT_ARTIFACTS).map(formatArtifactLabel);
    const extra = receipt.artifacts.length - shown.length;
    lines.push(`Artifacts: ${shown.join(", ")}${extra > 0 ? ` (+${extra} more)` : ""}`);
  }
  return lines.join("\n");
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

/** The bot whose project holds the thread, Home included; null for any other thread. */
const resolveThreadOwner = Effect.fn("bot.eventSync.resolveThreadOwner")(function* (
  deps: BotHomeDeps,
  threadId: string,
) {
  const thread = yield* deps.orchestration.getThread(threadId);
  if (thread === null) return null;
  const homes = yield* deps.store.getHomesByBot();
  const owner = [...homes].find(([, home]) => home.projectId === thread.projectId);
  return owner === undefined ? null : owner[0];
});

const resolveBotSession = Effect.fn("bot.eventSync.resolveBotSession")(function* (
  deps: BotHomeDeps,
  threadId: string,
) {
  const thread = yield* deps.orchestration.getThread(threadId);
  if (thread === null) return null;
  const homes = yield* deps.store.getHomesByBot();
  const owner = [...homes].find(([, home]) => home.projectId === thread.projectId);
  const homeThreadId = homes.get(MAIN_BOT_ID)?.homeThreadId ?? null;
  if (owner === undefined || homeThreadId === null || threadId === homeThreadId) {
    return null;
  }
  return {
    ownerId: owner[0],
    homeThreadId,
    thread,
  };
});

const trySettleThread = Effect.fn("bot.eventSync.trySettleThread")(function* (
  deps: BotHomeDeps,
  threadId: string,
  runId: string,
) {
  yield* deps.orchestration
    .settleThread({
      threadId,
      clientRequestId: `bot:settle:${runId}`,
    })
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning("bot session auto-settle skipped", { threadId, runId, error }),
      ),
    );
});

/**
 * A run just ended in some bot's project, so the skill edits it made (to the shared folder or to
 * its own) are now settled. Any thread counts, Home included: that is where an approved suggestion
 * is applied. Never fails the event: the next skill command reconciles again.
 */
const reconcileSkillsAfterRun = Effect.fn("bot.eventSync.reconcileSkills")(function* (
  deps: BotHomeDeps,
  threadId: string,
) {
  const thread = yield* deps.orchestration.getThread(threadId);
  if (thread === null) return;
  const homes = yield* deps.store.getHomesByBot();
  const owner = [...homes].find(([, home]) => home.projectId === thread.projectId);
  if (owner === undefined) return;
  yield* reconcileScopes(deps, [{ scope: "bot", botId: owner[0] }, { scope: "shared" }], {
    threadId,
  });
});

/** The events that can answer or end a review thread; the others never concern it. */
const isReviewRelevant = (event: BotHostThreadLifecycleEvent) =>
  event.type !== "run_status" ||
  event.status === "completed" ||
  event.status === "failed" ||
  event.status === "interrupted" ||
  event.status === "cancelled";

/**
 * Wakes Home on `run_output` (without settling mid-run) and handles auto-settle or missing-receipt
 * fallback once a bot-dispatched run reaches a terminal `run_status`.
 */
export const applyThreadLifecycleEvent = Effect.fn("bot.eventSync.applyEvent")(function* (
  deps: BotHomeDeps,
  event: BotHostThreadLifecycleEvent,
  review?: SkillReviewService,
) {
  // A background review's own thread sits in the bot's project but is nobody's session: it never
  // reaches the receipt logic below, so it cannot wake Home or be settled as a finished task.
  if (isReviewRelevant(event)) {
    const thread = yield* deps.orchestration.getThread(event.threadId);
    if (thread?.title.startsWith(SKILL_REVIEW_TITLE_PREFIX) === true) {
      if (review !== undefined) yield* review.handleThreadEvent(event);
      return false;
    }
  }

  if (event.type === "run_output") {
    const receipt = decodeReceipt(event.output);
    const spec = receipt._tag === "None" ? decodeSubBotSpec(event.output) : undefined;
    const workingFoldersUpdate =
      receipt._tag === "None" && spec?._tag !== "Some"
        ? decodeWorkingFoldersUpdate(event.output)
        : undefined;
    if (receipt._tag === "None" && spec?._tag !== "Some" && workingFoldersUpdate?._tag !== "Some") {
      return false;
    }

    const session = yield* resolveBotSession(deps, event.threadId);
    if (session === null) return false;
    const run = yield* deps.orchestration.readRunResult(event.threadId, event.runId);
    if (run?.createdBy !== "agent") return false;

    if (receipt._tag === "Some") {
      yield* deps.store.upsertSessionReceipt(session.ownerId, event.threadId, receipt.value);
      if (session.ownerId === MAIN_BOT_ID) yield* writeSessionLog(deps);
      if (receipt.value.status === "waiting_user") return true;
      yield* deps.orchestration.sendMessage({
        threadId: session.homeThreadId,
        text: formatReceiptForHome(event.threadId, session.thread.title, receipt.value),
        notification: {
          summary: session.thread.title,
          outcome: "completed",
          detail: BOT_WAKE_NOTIFICATION_DETAIL,
        },
        // One delivery per session run, even if the event is replayed.
        clientRequestId: `bot:receipt:${event.runId}`,
      });
      return true;
    }

    if (session.ownerId !== MAIN_BOT_ID) return false;

    if (spec?._tag === "Some") {
      const created = yield* createSubBot(deps, spec.value).pipe(
        Effect.map(({ bot, projectId }) => {
          const foldersNote =
            bot.workingFolders.length > 0
              ? ` Working folders: ${bot.workingFolders.join(", ")}.`
              : "";
          return {
            ok: true as const,
            text: `Sub-bot created: "${bot.name}" (projectId ${projectId}). ${bot.summary}${foldersNote}`,
          };
        }),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false as const,
            text: `Sub-bot "${spec.value.name}" was not created: ${error.message}`,
          }),
        ),
      );
      yield* deps.orchestration.sendMessage({
        threadId: session.homeThreadId,
        text: created.text,
        notification: {
          summary: session.thread.title,
          outcome: created.ok ? "completed" : "failed",
          detail: BOT_WAKE_NOTIFICATION_DETAIL,
        },
        clientRequestId: `bot:sub-bot:${event.runId}`,
      });
      return true;
    }

    if (workingFoldersUpdate?._tag !== "Some") return false;
    const updated = yield* applyBotWorkingFoldersUpdate(deps, workingFoldersUpdate.value).pipe(
      Effect.map((bot) => {
        const folderSummary =
          bot.workingFolders.length === 0
            ? "Working folders: none (workspace only)."
            : `Working folders: ${bot.workingFolders.join(", ")}.`;
        const projectNote = bot.projectId ? `, projectId ${bot.projectId}` : "";
        return {
          ok: true as const,
          text: `Working folders updated for "${bot.name}" (botId ${bot.id}${projectNote}). ${folderSummary}`,
        };
      }),
      Effect.catch((error) =>
        Effect.succeed({
          ok: false as const,
          text: `Working folders were not updated for "${workingFoldersUpdate.value.botId}": ${error.message}`,
        }),
      ),
    );
    yield* deps.orchestration.sendMessage({
      threadId: session.homeThreadId,
      text: updated.text,
      notification: {
        summary: session.thread.title,
        outcome: updated.ok ? "completed" : "failed",
        detail: BOT_WAKE_NOTIFICATION_DETAIL,
      },
      clientRequestId: `bot:working-folders:${event.runId}`,
    });
    return true;
  }

  if (
    event.type !== "run_status" ||
    (event.status !== "completed" && event.status !== "failed" && event.status !== "interrupted")
  ) {
    return false;
  }

  yield* reconcileSkillsAfterRun(deps, event.threadId).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("bot skill reconcile failed", { threadId: event.threadId, cause }),
    ),
  );

  if (event.status === "completed" && review !== undefined) {
    // Home counts too: it is where the user corrects Bot most, so it holds most of the lessons.
    const owner = yield* resolveThreadOwner(deps, event.threadId);
    if (owner !== null) {
      yield* review
        .noteRunCompleted(owner, event.threadId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("bot skill review count failed", { threadId: event.threadId, cause }),
          ),
        );
    }
  }

  const session = yield* resolveBotSession(deps, event.threadId);
  if (session === null) return false;

  const latest = yield* deps.orchestration.readRunResult(event.threadId, event.runId);
  if (latest === null) return false;
  if (latest.createdBy !== "agent") return false;

  const receipt = decodeReceipt(latest.output);
  if (receipt._tag === "Some") {
    if (latest.isLatestRun && event.status === "completed" && receipt.value.status === "done") {
      yield* trySettleThread(deps, event.threadId, event.runId);
      return true;
    }
    return false;
  }

  const spec = decodeSubBotSpec(latest.output);
  if (spec._tag === "Some" && session.ownerId === MAIN_BOT_ID) {
    if (latest.isLatestRun && event.status === "completed") {
      yield* trySettleThread(deps, event.threadId, event.runId);
      return true;
    }
    return false;
  }

  const workingFoldersUpdate = decodeWorkingFoldersUpdate(latest.output);
  if (workingFoldersUpdate._tag === "Some" && session.ownerId === MAIN_BOT_ID) {
    if (latest.isLatestRun && event.status === "completed") {
      yield* trySettleThread(deps, event.threadId, event.runId);
      return true;
    }
    return false;
  }

  const assistantDetail = latest.assistantText?.trim() ?? "";
  if (event.status === "completed") {
    yield* deps.orchestration.sendMessage({
      threadId: session.homeThreadId,
      text: formatReceiptForHome(event.threadId, session.thread.title, {
        status: "done",
        outcome: assistantDetail || "Completed without a structured summary.",
        artifacts: [],
      }),
      notification: {
        summary: session.thread.title,
        outcome: "completed",
        detail: BOT_WAKE_NOTIFICATION_DETAIL,
      },
      clientRequestId: `bot:receipt:${event.runId}`,
    });
    return true;
  }

  yield* deps.orchestration.sendMessage({
    threadId: session.homeThreadId,
    text: formatReceiptForHome(event.threadId, session.thread.title, {
      status: "blocked",
      outcome: assistantDetail
        ? `Session ${event.status}: ${assistantDetail}`
        : `Session ended (${event.status}).`,
      artifacts: [],
    }),
    notification: {
      summary: session.thread.title,
      outcome: "failed",
      detail: BOT_WAKE_NOTIFICATION_DETAIL,
    },
    clientRequestId: `bot:receipt:${event.runId}`,
  });
  return true;
});

/** A scoped fiber, so disabling or reloading the bot module stops it. */
export function startBotEventSyncWorker(deps: BotHomeDeps, review?: SkillReviewService) {
  return deps.orchestration.subscribeThreadEvents().pipe(
    Stream.runForEach((event) =>
      applyThreadLifecycleEvent(deps, event, review).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("bot session receipt failed", { threadId: event.threadId, cause }),
        ),
      ),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
}
