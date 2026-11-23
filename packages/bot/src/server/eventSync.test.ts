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
import { createBotInStateDir, ensureMainBotInStateDir, listStateDirBots } from "./registry.ts";
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
    "records only valid receipts from bot sessions and passes each to the main Home once",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        yield* store.upsertHome("main", { homeThreadId: "home", projectId: "p1" });
        const researcher = yield* createBotInStateDir(stateDir, { name: "Researcher" });
        yield* store.upsertHome(researcher.id, { homeThreadId: null, projectId: "p2" });

        const receipt = { status: "done", outcome: "Fixed the parser.", artifacts: ["src/p.ts"] };
        const sent: Array<BotHostSendMessageInput> = [];
        const orchestration: BotHostOrchestrationShape = {
          ensureProject: () => Effect.die("unused"),
          getThread: (threadId) =>
            Effect.succeed({
              threadId,
              projectId: threadId === "elsewhere" ? "other" : threadId === "survey" ? "p2" : "p1",
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
              output("survey", "r5", { ...receipt, artifacts: [] }),
              { type: "run_status", threadId: "fix", runId: "r1", status: "completed" },
            ]),
        };

        yield* Fiber.join(yield* startBotEventSyncWorker({ stateDir, store, orchestration }));

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
          {
            threadId: "home",
            text: 'Session receipt from "Title of survey" (sub-bot "Researcher"): done.\nFixed the parser.',
            clientRequestId: "bot:receipt:r5",
          },
        ]);
        expect((yield* store.listSessionReceipts(researcher.id)).map((r) => r.threadId)).toEqual([
          "survey",
        ]);
        // Only Bot's own one-off sessions count toward spotting recurring work.
        const log = yield* fs.readFileString(
          path.join(stateDir, "bots", "main", "workspace", "SESSIONS.md"),
        );
        expect(log).toContain("| Title of fix | done | Fixed the parser. |");
        expect(log).not.toContain("survey");
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("builds a sub-bot only from a valid spec handed back in the main bot's project", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
      yield* ensureMainBotInStateDir(stateDir);
      yield* store.upsertHome("main", { homeThreadId: "home", projectId: "p1" });
      yield* store.upsertHome("other-sub", { homeThreadId: null, projectId: "p2" });

      const repo = path.join(stateDir, "repo");
      const spec = {
        name: "Coder",
        summary: "Ships small fixes.",
        inScope: ["bug fixes"],
        outOfScope: ["research -> Researcher"],
        persona: "A careful engineer.",
        projects: [repo, "relative/ignored"],
      };
      const projectsByRoot = new Map<string, string>();
      const sent: Array<BotHostSendMessageInput> = [];
      const orchestration: BotHostOrchestrationShape = {
        ensureProject: ({ workspaceRoot }) =>
          Effect.sync(() => {
            const projectId = projectsByRoot.get(workspaceRoot) ?? `project:${workspaceRoot}`;
            projectsByRoot.set(workspaceRoot, projectId);
            return { projectId };
          }),
        getThread: (threadId) =>
          Effect.succeed({ threadId, projectId: threadId === "in-sub" ? "p2" : "p1", title: "t" }),
        launchThread: () => Effect.die("unused"),
        sendMessage: (input) =>
          Effect.sync(() => {
            sent.push(input);
            return { threadId: input.threadId, messageId: "m", sequence: sent.length };
          }),
        readLatestResult: () => Effect.succeed(null),
        subscribeThreadEvents: () =>
          Stream.fromIterable([
            output("hire", "r1", spec),
            output("in-sub", "r2", { ...spec, name: "Rogue" }),
            output("hire-again", "r3", spec),
            output("bad", "r4", { ...spec, projects: "not a list" }),
          ]),
      };

      yield* Fiber.join(yield* startBotEventSyncWorker({ stateDir, store, orchestration }));

      const homes = yield* store.getHomesByBot();
      const coder = (yield* listStateDirBots(stateDir, homes)).bots.find(
        (bot) => bot.name === "Coder",
      );
      expect(coder).toMatchObject({
        role: "sub",
        status: "active",
        inScope: ["bug fixes"],
        projectId: `project:${path.join(coder?.path ?? "", "workspace")}`,
        homeThreadId: null,
      });
      expect([...projectsByRoot.keys()]).toEqual([repo, path.join(coder?.path ?? "", "workspace")]);
      const instructions = yield* fs.readFileString(
        path.join(coder?.path ?? "", "workspace", "AGENTS.md"),
      );
      expect(instructions).toContain(`| ${repo} | project:${repo} |`);
      const mainInstructions = yield* fs.readFileString(
        path.join(stateDir, "bots", "main", "workspace", "AGENTS.md"),
      );
      expect(mainInstructions).toContain(`| Coder: Ships small fixes. | ${coder?.projectId} |`);

      expect(sent.map(({ text, clientRequestId }) => [clientRequestId, text])).toEqual([
        [
          "bot:sub-bot:r1",
          `Sub-bot created: "Coder" (projectId ${coder?.projectId}). Ships small fixes.`,
        ],
        ["bot:sub-bot:r3", 'Sub-bot "Coder" was not created: A bot named "Coder" already exists.'],
      ]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
