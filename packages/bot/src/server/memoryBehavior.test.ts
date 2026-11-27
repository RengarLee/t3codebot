import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { MAIN_BOT_ID } from "../contracts.ts";
import { makeBotFileService } from "./botFiles.ts";
import { openBotStore } from "./db.ts";
import { applyThreadLifecycleEvent } from "./eventSync.ts";
import type {
  BotHostLaunchThreadInput,
  BotHostOrchestrationShape,
  BotHostSendMessageInput,
  BotHostSettleThreadInput,
  BotHostThreadLifecycleEvent,
  BotHostThreadMessage,
} from "./host.ts";
import { refreshBotsForSkills } from "./instructions.ts";
import { createBotInStateDir, ensureMainBotInStateDir } from "./registry.ts";
import { makeSkillReview, type SkillReviewPolicy } from "./skillReview.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const NOW_MS = 1_790_000_000_000;
const CHAT: ReadonlyArray<BotHostThreadMessage> = [
  { id: "m1", role: "user", text: "Make the report landscape", createdBy: "user" },
  { id: "m2", role: "assistant", text: "Done, landscape now.", createdBy: "agent" },
];

const setup = Effect.fn("test.setup")(function* (
  policy: Partial<SkillReviewPolicy> = {},
  options: {
    readonly chats?: ReadonlyArray<string>;
    /** The scope the review lives in; closing it is how a module is disposed. */
    readonly reviewScope?: Scope.Scope;
  } = {},
) {
  yield* TestClock.setTime(NOW_MS);
  const launches = yield* Queue.unbounded<BotHostLaunchThreadInput>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fs.makeTempDirectoryScoped();
  const sqlitePath = path.join(stateDir, "bots", "bots.sqlite");
  const store = yield* openBotStore(sqlitePath);
  yield* ensureMainBotInStateDir(stateDir);
  yield* createBotInStateDir(stateDir, { name: "Helper", id: "helper" });
  yield* store.upsertHome(MAIN_BOT_ID, { homeThreadId: "main-home", projectId: "p-main" });
  yield* store.upsertHome("helper", { homeThreadId: null, projectId: "p-helper" });

  const threads = new Map<string, { readonly projectId: string; readonly title: string }>();
  const chats = new Map<string, ReadonlyArray<BotHostThreadMessage>>();
  const launched: Array<BotHostLaunchThreadInput> = [];
  const launchedIds = new Map<string, string>();
  const settled: Array<BotHostSettleThreadInput> = [];
  const sent: Array<BotHostSendMessageInput> = [];
  const addChat = (threadId: string, messages: ReadonlyArray<BotHostThreadMessage> = CHAT) => {
    threads.set(threadId, { projectId: "p-helper", title: `Chat ${threadId}` });
    chats.set(threadId, messages);
  };
  for (const threadId of options.chats ?? ["t1"]) addChat(threadId);

  const orchestration: BotHostOrchestrationShape = {
    readSessions: () => Effect.succeed({ sessions: [], hasMore: false }),
    ensureProject: () => Effect.die("unused"),
    syncProjectFolders: () => Effect.void,
    updateProjectTitle: () => Effect.void,
    getThread: (threadId) =>
      Effect.sync(() => {
        const thread = threads.get(threadId);
        return thread === undefined ? null : { threadId, ...thread };
      }),
    launchThread: (input) =>
      Effect.gen(function* () {
        const key = input.clientRequestId ?? `anonymous-${launched.length}`;
        const known = launchedIds.get(key);
        if (known !== undefined) {
          return { threadId: known, projectId: input.projectId, resumed: true };
        }
        launched.push(input);
        const threadId = `review-${launched.length}`;
        launchedIds.set(key, threadId);
        threads.set(threadId, { projectId: input.projectId, title: input.title });
        yield* Queue.offer(launches, input);
        return { threadId, projectId: input.projectId, resumed: false };
      }),
    sendMessage: (input) =>
      Effect.sync(() => {
        sent.push(input);
        return { threadId: input.threadId, messageId: "m", sequence: sent.length };
      }),
    settleThread: (input) =>
      Effect.sync(() => {
        settled.push(input);
      }),
    readRunResult: () => Effect.succeed(null),
    readThreadMessages: (threadId) =>
      Effect.sync(() => {
        return chats.get(threadId) ?? null;
      }),
    subscribeThreadEvents: () => Stream.empty,
  };
  const deps = { stateDir, store, orchestration };
  const refreshed: string[] = [];
  const botFiles = yield* makeBotFileService(
    stateDir,
    store,
    Effect.sync(() => {
      refreshed.push("changed");
    }),
  );
  const review = yield* makeSkillReview(deps, { policy, botFiles }).pipe(
    Scope.provide(options.reviewScope ?? (yield* Scope.Scope)),
  );

  const apply = (event: BotHostThreadLifecycleEvent) =>
    applyThreadLifecycleEvent(deps, event, review);
  let runCounter = 0;
  const completeRuns = Effect.fn("test.completeRuns")(function* (threadId: string, count: number) {
    for (let index = 0; index < count; index += 1) {
      runCounter += 1;
      yield* apply({
        type: "run_status",
        threadId,
        runId: `run-${runCounter}`,
        status: "completed",
      });
    }
  });
  /** Waits for the next review thread the host was asked to launch. */
  const nextLaunch = Queue.take(launches);
  const answer = Effect.fn("test.answer")(function* (reviewThreadId: string, value: unknown) {
    yield* apply({
      type: "run_output",
      threadId: reviewThreadId,
      runId: "review-run",
      output: value,
    });
    yield* apply({
      type: "run_status",
      threadId: reviewThreadId,
      runId: "review-run",
      status: "completed",
    });
  });
  return {
    store,
    sqlitePath,
    botFiles,
    refreshed,
    stateDir,
    deps,
    review,
    apply,
    completeRuns,
    nextLaunch,
    answer,
    addChat,
    threads,
    launched,
    launchedIds,
    settled,
    sent,
  };
});

describe("cross-session standing memory", () => {
  it.effect("shares a reviewed preference with another bot and removes it after restore", () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      fixture.addChat("t1", [
        { id: "pref", role: "user", createdBy: "user", text: "Always answer in Chinese." },
      ]);
      yield* fixture.completeRuns("t1", 10);
      yield* fixture.nextLaunch;
      yield* fixture.answer("review-1", {
        skill: null,
        memory: [{ op: "add", scope: "user", old: "", text: "Prefers Chinese responses." }],
      });
      yield* fixture.review.idle;
      yield* createBotInStateDir(fixture.stateDir, { name: "Reader", id: "reader" });
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const agents = path.join(fixture.stateDir, "bots", "reader", "workspace", "AGENTS.md");
      const reopened = yield* openBotStore(fixture.sqlitePath);
      yield* refreshBotsForSkills({ stateDir: fixture.stateDir, store: reopened });
      expect(yield* fs.readFileString(agents)).toContain("Prefers Chinese responses.");
      const revisions = yield* reopened.listMemoryRevisions("shared", 50);
      const original = revisions.find((entry) => entry.content === "");
      if (!original) throw new Error("Missing initial revision");
      const current = yield* fixture.botFiles.read("reader", "USER.md");
      yield* fixture.botFiles.command("restore", {
        botId: "reader",
        path: "USER.md",
        expectedVersion: current.version,
        revision: original.revision,
      });
      yield* refreshBotsForSkills({ stateDir: fixture.stateDir, store: reopened });
      expect(yield* fs.readFileString(agents)).not.toContain("Prefers Chinese responses.");
      fixture.addChat("t1", [
        { id: "pref2", role: "user", createdBy: "user", text: "Always answer in Chinese." },
      ]);
      yield* fixture.completeRuns("t1", 10);
      yield* fixture.nextLaunch;
      const restored = yield* fixture.botFiles.read("reader", "USER.md");
      yield* fixture.botFiles.command("save", {
        botId: "reader",
        path: "USER.md",
        expectedVersion: restored.version,
        content: "- Prefers French responses.\n",
      });
      yield* fixture.answer("review-2", {
        skill: null,
        memory: [{ op: "add", scope: "user", old: "", text: "Prefers Chinese responses." }],
      });
      yield* fixture.review.idle;
      yield* refreshBotsForSkills({ stateDir: fixture.stateDir, store: reopened });
      expect(yield* fs.readFileString(agents)).toContain("Prefers French responses.");
      expect(yield* fs.readFileString(agents)).not.toContain("Prefers Chinese responses.");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
