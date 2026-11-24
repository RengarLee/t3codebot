import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { openBotStore } from "./db.ts";
import { ensureBotHome } from "./home.ts";
import type { BotHostOrchestrationShape } from "./host.ts";
import { MAIN_BOT_ID } from "../contracts.ts";
import { createBotInStateDir, ensureMainBotInStateDir } from "./registry.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

function makeHost() {
  const projectsByRoot = new Map<string, string>();
  const liveThreads = new Map<string, string>();
  const launches: Array<{ readonly projectId: string; readonly title: string }> = [];
  const orchestration: BotHostOrchestrationShape = {
    ensureProject: ({ workspaceRoot }) =>
      Effect.sync(() => {
        const projectId = projectsByRoot.get(workspaceRoot) ?? `project:${projectsByRoot.size}`;
        projectsByRoot.set(workspaceRoot, projectId);
        return { projectId };
      }),
    getThread: (threadId) =>
      Effect.sync(() => {
        const projectId = liveThreads.get(threadId);
        return projectId === undefined ? null : { threadId, projectId, title: "Home" };
      }),
    launchThread: ({ projectId, title }) =>
      Effect.sync(() => {
        launches.push({ projectId, title });
        const threadId = `thread:home:${launches.length}`;
        liveThreads.set(threadId, projectId);
        return { threadId, projectId, resumed: false };
      }),
    sendMessage: () => Effect.die("unused"),
    settleThread: () => Effect.void,
    readLatestResult: () => Effect.succeed(null),
    subscribeThreadEvents: () => Stream.empty,
  };
  return { orchestration, projectsByRoot, liveThreads, launches };
}

describe("bot Home", () => {
  it.effect(
    "opens Home in the bot's own project, reuses it, and relaunches once it is deleted",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        const host = makeHost();
        const deps = { stateDir, store, orchestration: host.orchestration };
        const bot = yield* createBotInStateDir(stateDir, { name: "总管" });

        const first = yield* ensureBotHome(deps, bot.id);
        expect([...host.projectsByRoot.keys()]).toEqual([path.join(bot.path, "workspace")]);
        expect(host.launches).toEqual([{ projectId: first.projectId, title: "总管 Home" }]);

        const again = yield* ensureBotHome(deps, bot.id);
        expect(again.homeThreadId).toBe(first.homeThreadId);
        expect(host.launches).toHaveLength(1);

        host.liveThreads.delete(first.homeThreadId ?? "");
        const relaunched = yield* ensureBotHome(deps, bot.id);
        expect(relaunched.homeThreadId).not.toBe(first.homeThreadId);
        expect(relaunched.projectId).toBe(first.projectId);
        expect((yield* store.getHome(bot.id))?.homeThreadId).toBe(relaunched.homeThreadId);

        yield* ensureMainBotInStateDir(stateDir);
        yield* ensureBotHome(deps, MAIN_BOT_ID);
        expect(host.launches.at(-1)?.title).toBe("Home");

        const missing = yield* Effect.flip(ensureBotHome(deps, "no-such-bot"));
        expect(missing._tag).toBe("BotNotFoundError");
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
