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
import type {
  BotHostOrchestrationShape,
  BotHostSendMessageInput,
  BotHostThreadLifecycleEvent,
} from "./host.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const output = (threadId: string, runId: string, value: unknown): BotHostThreadLifecycleEvent => ({
  type: "run_output",
  threadId,
  runId,
  output: value,
});

describe("bot session receipts", () => {
  it.effect(
    "records only valid receipts from a bot's sessions and passes each to its Home once",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        yield* store.upsertHome("main", { homeThreadId: "home", projectId: "p1" });

        const receipt = { status: "done", outcome: "Fixed the parser.", artifacts: ["src/p.ts"] };
        const sent: Array<BotHostSendMessageInput> = [];
        const orchestration: BotHostOrchestrationShape = {
          ensureProject: () => Effect.die("unused"),
          getThread: (threadId) =>
            Effect.succeed({
              threadId,
              projectId: threadId === "elsewhere" ? "other" : "p1",
              title: `Title of ${threadId}`,
            }),
          launchThread: () => Effect.die("unused"),
          sendMessage: (input) =>
            Effect.sync(() => {
              sent.push(input);
              return { threadId: input.threadId, messageId: "m", sequence: sent.length };
            }),
          readLatestResult: () => Effect.succeed(null),
          subscribeThreadEvents: () =>
            Stream.fromIterable([
              output("fix", "r1", receipt),
              output("draft", "r2", { summary: "free text, not a receipt" }),
              output("home", "r3", receipt),
              output("elsewhere", "r4", receipt),
              { type: "run_status", threadId: "fix", runId: "r1", status: "completed" },
            ]),
        };

        yield* Fiber.join(yield* startBotEventSyncWorker({ store, orchestration }));

        const receipts = yield* store.listSessionReceipts("main");
        expect(receipts.map(({ threadId, status }) => [threadId, status])).toEqual([
          ["fix", "done"],
        ]);
        expect(sent).toEqual([
          {
            threadId: "home",
            text: 'Session receipt from "Title of fix": done.\nFixed the parser.\nArtifacts: src/p.ts',
            clientRequestId: "bot:receipt:r1",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
