import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { openBotStore } from "./db.ts";
import { startBotEventSyncWorker } from "./eventSync.ts";
import type { BotHostOrchestrationShape, BotHostThreadLifecycleEvent } from "./host.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

function makeMockOrchestration(
  events: ReadonlyArray<BotHostThreadLifecycleEvent>,
  latestTextByThread: Readonly<Record<string, string>> = {},
): BotHostOrchestrationShape {
  return {
    ensureProject: () => Effect.succeed({ projectId: "project:mock" }),
    getThread: () => Effect.succeed(null),
    launchThread: () =>
      Effect.succeed({ threadId: "thread:mock", projectId: "project:mock", resumed: false }),
    sendMessage: () =>
      Effect.succeed({ threadId: "thread:mock", messageId: "msg:mock", sequence: 1 }),
    readLatestResult: (threadId) =>
      Effect.succeed({
        threadId,
        latestRunStatus: "completed",
        latestAssistantText: latestTextByThread[threadId] ?? null,
        latestOutput: null,
      }),
    subscribeThreadEvents: () => Stream.fromIterable(events),
  };
}

describe("bot event sync worker (P-656)", () => {
  it.effect(
    "automatically syncs child thread question, structured output decision, and completion into bots.sqlite",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(tempDir, "bots", "bots.sqlite"));

        const botId = "bot-sync-1";
        const childThreadId = "thread:child:42";
        const created = yield* store.createTask(botId, {
          title: "排查支付超时",
          goal: "定位超时根因并给出修复方案",
          childThreadId,
        });

        const events: ReadonlyArray<BotHostThreadLifecycleEvent> = [
          {
            type: "runtime_request_pending",
            threadId: childThreadId,
            requestId: "req-1",
            kind: "user_input",
          },
          {
            type: "run_output",
            threadId: childThreadId,
            runId: "run-1",
            output: {
              decision: "连接池上限从 10 调至 30，已通过压测",
              status: "completed",
            },
          },
        ];

        const worker = yield* startBotEventSyncWorker(store, makeMockOrchestration(events));
        yield* Fiber.await(worker);

        const updated = yield* store.getTask(botId, created.task.id);
        expect(updated?.status).toBe("completed");
        expect(updated?.latestDecision).toBe("连接池上限从 10 调至 30，已通过压测");
        expect(updated?.completedAt).not.toBeNull();

        // Completed task is immediately excluded from Home active context.
        const activeForHome = yield* store.listActiveTasksForHomeContext(botId);
        expect(activeForHome).toHaveLength(0);

        const snapshot = yield* store.listBotTasks(botId);
        expect(snapshot.recentCards.map((card) => card.kind)).toEqual([
          "task_dispatched",
          "task_status",
          "task_decision",
        ]);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("updates active task summary from latest assistant text when child run completes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped();
      const store = yield* openBotStore(path.join(tempDir, "bots", "bots.sqlite"));

      const botId = "bot-sync-2";
      const childThreadId = "thread:child:99";
      const created = yield* store.createTask(botId, {
        title: "调研上游改动",
        childThreadId,
      });

      const orchestration = makeMockOrchestration(
        [
          {
            type: "run_status",
            threadId: childThreadId,
            runId: "run-2",
            status: "completed",
          },
        ],
        {
          [childThreadId]: "已完成对比，上游改动不影响 bots 模块，可继续跟进。",
        },
      );

      const worker = yield* startBotEventSyncWorker(store, orchestration);
      yield* Fiber.await(worker);

      const updated = yield* store.getTask(botId, created.task.id);
      expect(updated?.status).toBe("active");
      expect(updated?.latestSummary).toBe("已完成对比，上游改动不影响 bots 模块，可继续跟进。");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
