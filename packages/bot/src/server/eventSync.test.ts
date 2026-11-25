import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { BOT_WAKE_NOTIFICATION_DETAIL } from "../contracts.ts";
import { openBotStore } from "./db.ts";
import { applyThreadLifecycleEvent, startBotEventSyncWorker } from "./eventSync.ts";
import { createBotInStateDir, ensureMainBotInStateDir, listStateDirBots } from "./registry.ts";
import {
  BotHostError,
  type BotHostOrchestrationShape,
  type BotHostSendMessageInput,
  type BotHostSettleThreadInput,
  type BotHostThreadRunResult,
  type BotHostThreadLifecycleEvent,
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
    "routes alternating senders by run in both bot projects without settling a newer conversation",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        yield* store.upsertHome("main", { homeThreadId: "home", projectId: "main-project" });
        yield* store.upsertHome("tutor", { homeThreadId: null, projectId: "tutor-project" });
        const sent: Array<BotHostSendMessageInput> = [];
        const settled: Array<BotHostSettleThreadInput> = [];
        const receipt = { status: "done", outcome: "Answer", artifacts: [] };
        for (const owner of ["main", "tutor"]) {
          const threadId = `${owner}-session`;
          const orchestration: BotHostOrchestrationShape = {
            ensureProject: () => Effect.die("unused"),
            getThread: () =>
              Effect.succeed({ threadId, projectId: `${owner}-project`, title: "Practice" }),
            launchThread: () => Effect.die("unused"),
            sendMessage: (input) =>
              Effect.sync(() => {
                sent.push(input);
                return { threadId: input.threadId, messageId: "m", sequence: sent.length };
              }),
            settleThread: (input) =>
              Effect.sync(() => {
                settled.push(input);
              }),
            readRunResult: (requestedThread, runId) =>
              Effect.succeed({
                threadId: requestedThread,
                runId,
                isLatestRun: runId === "user-new",
                status: "completed",
                createdBy: runId === "bot-old" ? "agent" : "user",
                hasOutputSchema: true,
                assistantText: "Answer",
                output: receipt,
              }),
            subscribeThreadEvents: () => Stream.empty,
          };
          const deps = { stateDir, store, orchestration };
          for (const runId of ["user-old", "bot-old", "user-new"]) {
            yield* applyThreadLifecycleEvent(deps, output(threadId, runId, receipt));
            yield* applyThreadLifecycleEvent(deps, {
              type: "run_status",
              threadId,
              runId,
              status: "completed",
            });
          }
          expect((yield* store.listSessionReceipts(owner)).map((entry) => entry.threadId)).toEqual([
            threadId,
          ]);
        }
        expect(sent.map((entry) => entry.clientRequestId)).toEqual([
          "bot:receipt:bot-old",
          "bot:receipt:bot-old",
        ]);
        expect(settled).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

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
        const needsDecision = {
          status: "needs_decision",
          outcome: "Choose between option A and B.",
          artifacts: [],
        };
        const sent: Array<BotHostSendMessageInput> = [];
        const settled: Array<BotHostSettleThreadInput> = [];
        const resultsByThread = new Map<string, BotHostThreadRunResult>([
          [
            "fix",
            {
              threadId: "fix",
              runId: "r1",
              isLatestRun: true,
              status: "completed",
              createdBy: "agent",
              hasOutputSchema: true,
              assistantText: "Fixed the parser.",
              output: receipt,
            },
          ],
          [
            "survey",
            {
              threadId: "survey",
              runId: "r5",
              isLatestRun: true,
              status: "completed",
              createdBy: "agent",
              hasOutputSchema: true,
              assistantText: "Choose between option A and B.",
              output: needsDecision,
            },
          ],
        ]);
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
          settleThread: (input) =>
            Effect.sync(() => {
              settled.push(input);
            }),
          readRunResult: (threadId) => Effect.succeed(resultsByThread.get(threadId) ?? null),
          subscribeThreadEvents: () =>
            Stream.fromIterable([
              output("fix", "r1", receipt),
              output("draft", "r2", { summary: "free text, not a receipt" }),
              output("home", "r3", receipt),
              output("elsewhere", "r4", receipt),
              output("survey", "r5", needsDecision),
              { type: "run_status", threadId: "fix", runId: "r1", status: "completed" },
              { type: "run_status", threadId: "survey", runId: "r5", status: "completed" },
            ]),
        };

        yield* Fiber.join(yield* startBotEventSyncWorker({ stateDir, store, orchestration }));

        const receipts = yield* store.listSessionReceipts("main");
        expect(receipts.map(({ threadId, status }) => [threadId, status])).toEqual([
          ["fix", "done"],
        ]);
        expect(settled).toEqual([{ threadId: "fix", clientRequestId: "bot:settle:r1" }]);
        expect(sent).toEqual([
          {
            threadId: "home",
            text: "Session finished (done): [Title of fix](t3-thread://v1/fix)\nFixed the parser.\nArtifacts: src/p.ts",
            notification: {
              summary: "Title of fix",
              outcome: "completed",
              detail: BOT_WAKE_NOTIFICATION_DETAIL,
            },
            clientRequestId: "bot:receipt:r1",
          },
          {
            threadId: "home",
            text: "Session finished (needs_decision): [Title of survey](t3-thread://v1/survey)\nChoose between option A and B.",
            notification: {
              summary: "Title of survey",
              outcome: "completed",
              detail: BOT_WAKE_NOTIFICATION_DETAIL,
            },
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
        settleThread: () => Effect.void,
        readRunResult: (threadId, runId) =>
          Effect.succeed({
            threadId,
            runId,
            isLatestRun: true,
            status: "completed",
            createdBy: "agent",
            assistantText: null,
            output: spec,
          }),
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

  it.effect(
    "compresses long receipts, settles only after completion, falls back when a bot run omits output, and ignores direct user turns",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        yield* store.upsertHome("main", { homeThreadId: "home", projectId: "p1" });

        const longOutcome = `Summary:\n${"A".repeat(320)}`;
        const longReceipt = {
          status: "done",
          outcome: longOutcome,
          artifacts: [
            "D:\\repos\\t3codebot\\.t3\\bots\\sub\\workspace\\outputs\\weekly-2026-11-23.md",
            "/tmp/notes/second.md",
            "src/a.ts",
            "src/b.ts",
          ],
        };
        const resultsByThread = new Map<string, BotHostThreadRunResult>([
          [
            "report",
            {
              threadId: "report",
              runId: "r-report",
              isLatestRun: true,
              status: "completed",
              createdBy: "agent",
              hasOutputSchema: true,
              assistantText: "Full weekly report...",
              output: longReceipt,
            },
          ],
          [
            "forgot-receipt",
            {
              threadId: "forgot-receipt",
              runId: "r-forgot",
              isLatestRun: true,
              status: "completed",
              createdBy: "agent",
              hasOutputSchema: true,
              assistantText: "Finished checking upstream PRs without calling submit output.",
              output: null,
            },
          ],
          [
            "crashed",
            {
              threadId: "crashed",
              runId: "r-crashed",
              isLatestRun: true,
              status: "failed",
              createdBy: "agent",
              hasOutputSchema: false,
              assistantText: "Rate limit exceeded.",
              output: null,
            },
          ],
          [
            "english-practice",
            {
              threadId: "english-practice",
              runId: "r-user-turn",
              isLatestRun: true,
              status: "completed",
              createdBy: "user",
              hasOutputSchema: true,
              assistantText: "Great pronunciation! Try the next sentence.",
              output: { status: "done", outcome: "Direct answer", artifacts: [] },
            },
          ],
        ]);

        const eventsOrder: Array<string> = [];
        const sent: Array<BotHostSendMessageInput> = [];
        const orchestration: BotHostOrchestrationShape = {
          ensureProject: () => Effect.die("unused"),
          getThread: (threadId) => Effect.succeed({ threadId, projectId: "p1", title: threadId }),
          launchThread: () => Effect.die("unused"),
          sendMessage: (input) =>
            Effect.sync(() => {
              eventsOrder.push(`send:${input.clientRequestId}`);
              sent.push(input);
              return { threadId: input.threadId, messageId: "m", sequence: sent.length };
            }),
          settleThread: (input) =>
            Effect.gen(function* () {
              eventsOrder.push(`settle:${input.threadId}`);
              return yield* new BotHostError({
                operation: "settleThread",
                detail: "simulated settle failure",
              });
            }),
          readRunResult: (threadId) => Effect.succeed(resultsByThread.get(threadId) ?? null),
          subscribeThreadEvents: () =>
            Stream.fromIterable([
              output("report", "r-report", longReceipt),
              { type: "run_status", threadId: "report", runId: "r-report", status: "completed" },
              {
                type: "run_status",
                threadId: "forgot-receipt",
                runId: "r-forgot",
                status: "completed",
              },
              { type: "run_status", threadId: "crashed", runId: "r-crashed", status: "failed" },
              output("english-practice", "r-user-turn", {
                status: "done",
                outcome: "Direct answer",
                artifacts: [],
              }),
              {
                type: "run_status",
                threadId: "english-practice",
                runId: "r-user-turn",
                status: "completed",
              },
            ]),
        };

        yield* Fiber.join(yield* startBotEventSyncWorker({ stateDir, store, orchestration }));

        // Home is notified on run_output BEFORE settle runs on run_status: completed.
        expect(eventsOrder).toEqual([
          "send:bot:receipt:r-report",
          "settle:report",
          "send:bot:receipt:r-forgot",
          "send:bot:receipt:r-crashed",
        ]);

        expect(sent).toHaveLength(3);
        // Long receipt is compactly truncated and absolute artifact paths are shortened to basenames.
        expect(sent[0]?.text).toContain("… (full details in session)");
        expect(sent[0]?.text).toContain(
          "Artifacts: weekly-2026-11-23.md, second.md, src/a.ts (+1 more)",
        );
        expect(sent[0]?.text).not.toContain("D:\\repos\\");
        // Fallback completed run wakes Home without auto-settling.
        expect(sent[1]?.text).toBe(
          "Session finished (done): [forgot-receipt](t3-thread://v1/forgot-receipt)\nFinished checking upstream PRs without calling submit output.",
        );
        // Failed bot run wakes Home with failed outcome.
        expect(sent[2]).toMatchObject({
          text: "Session finished (blocked): [crashed](t3-thread://v1/crashed)\nSession failed: Rate limit exceeded.",
          notification: { outcome: "failed", detail: BOT_WAKE_NOTIFICATION_DETAIL },
        });
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
