import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { openBotStore } from "./db.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("bot sqlite store (bots.sqlite)", () => {
  it.effect(
    "persists bot_homes, bot_tasks, and bot_home_cards with strict active-context isolation",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped();
        const sqlitePath = path.join(tempDir, "bots", "bots.sqlite");
        const botId = "041a4d07-1b2c-4841-bc84-2250da1f41b2";

        const store = yield* openBotStore(sqlitePath);

        // 1. Bind Home thread to bot.
        const bound = yield* store.upsertHome(botId, {
          homeThreadId: "thread:home:1",
          projectId: "proj-1",
        });
        expect(bound.botId).toBe(botId);
        expect(bound.homeThreadId).toBe("thread:home:1");
        expect(bound.projectId).toBe("proj-1");
        expect(yield* store.getHomesByBot()).toEqual(
          new Map([[botId, { projectId: "proj-1", homeThreadId: "thread:home:1" }]]),
        );

        // 2. Create two independent tasks; each atomically records a task_dispatched card.
        const first = yield* store.createTask(botId, {
          title: "登录接口超时排查",
          goal: "排查并修复登录接口偶发超时",
          childThreadId: "thread:task:1",
        });
        const second = yield* store.createTask(botId, {
          title: "支付回调重试",
          goal: "检查回调幂等性",
          childThreadId: "thread:task:2",
        });
        expect(first.task.status).toBe("active");
        expect(first.card.kind).toBe("task_dispatched");
        expect(second.task.status).toBe("active");

        // Both appear in Home's thin active context.
        const initialActive = yield* store.listActiveTasksForHomeContext(botId);
        expect(initialActive.map((task) => task.id).sort()).toEqual(
          [first.task.id, second.task.id].sort(),
        );

        // 3. Commit a decision and move first task to waiting_user -> still active for Home.
        const waitingUpdate = yield* store.updateTask(botId, first.task.id, {
          status: "waiting_user",
          latestDecision: "先按方案 B 调大超时到 8s，等你确认是否顺便改重试次数",
        });
        expect(waitingUpdate.task.status).toBe("waiting_user");
        expect(waitingUpdate.task.completedAt).toBeNull();
        expect(waitingUpdate.card?.kind).toBe("task_decision");

        // 4. Complete second task -> MUST disappear from Home's active context (hard anti-pollution),
        // while remaining queryable in completedTasks for the sidebar history tab.
        const completedUpdate = yield* store.updateTask(botId, second.task.id, {
          status: "completed",
          latestDecision: "幂等键已加唯一索引并通过回归",
        });
        expect(completedUpdate.task.status).toBe("completed");
        expect(completedUpdate.task.completedAt).not.toBeNull();
        expect(completedUpdate.card?.kind).toBe("task_decision");

        const activeForHome = yield* store.listActiveTasksForHomeContext(botId);
        expect(activeForHome.map((task) => task.id)).toEqual([first.task.id]);

        const snapshot = yield* store.listBotTasks(botId);
        expect(snapshot.home?.homeThreadId).toBe("thread:home:1");
        expect(snapshot.activeTasks).toHaveLength(1);
        expect(snapshot.completedTasks).toHaveLength(1);
        expect(snapshot.completedTasks[0]?.id).toBe(second.task.id);
        expect(snapshot.recentCards.map((card) => card.kind)).toEqual([
          "task_dispatched",
          "task_dispatched",
          "task_decision",
          "task_decision",
        ]);

        // 5. Task counts aggregate active vs completed accurately.
        const counts = yield* store.getTaskCountsByBot();
        expect(counts.get(botId)).toEqual({ active: 1, completed: 1 });
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("re-opens existing bots.sqlite idempotently without losing records", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped();
      const sqlitePath = path.join(tempDir, "bots", "bots.sqlite");
      const botId = "bot-persist-1";

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openBotStore(sqlitePath);
          yield* store.createTask(botId, { title: "跨重启持久化验证" });
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reopened = yield* openBotStore(sqlitePath);
          const snapshot = yield* reopened.listBotTasks(botId);
          expect(snapshot.activeTasks).toHaveLength(1);
          expect(snapshot.activeTasks[0]?.title).toBe("跨重启持久化验证");
        }),
      );
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
