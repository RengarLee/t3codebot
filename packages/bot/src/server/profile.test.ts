import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { MAIN_BOT_ID } from "../contracts.ts";
import { openBotStore } from "./db.ts";
import type { BotHostOrchestrationShape, BotHostUpdateProjectTitleInput } from "./host.ts";
import { updateBotProfile } from "./profile.ts";
import { createBotInStateDir, ensureMainBotInStateDir } from "./registry.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

function makeHost() {
  const renamed: Array<BotHostUpdateProjectTitleInput> = [];
  const projectsByRoot = new Map<string, string>();
  const orchestration: BotHostOrchestrationShape = {
    readSessions: () => Effect.succeed({ sessions: [], hasMore: false }),
    ensureProject: ({ workspaceRoot }) =>
      Effect.sync(() => {
        const projectId = projectsByRoot.get(workspaceRoot) ?? `project:${projectsByRoot.size}`;
        projectsByRoot.set(workspaceRoot, projectId);
        return { projectId };
      }),
    syncProjectFolders: () => Effect.void,
    updateProjectTitle: (input) =>
      Effect.sync(() => {
        renamed.push(input);
      }),
    getThread: () => Effect.succeed(null),
    launchThread: () => Effect.die("unused"),
    sendMessage: () => Effect.die("unused"),
    settleThread: () => Effect.void,
    readRunResult: () => Effect.succeed(null),
    readThreadMessages: () => Effect.succeed(null),
    subscribeThreadEvents: () => Stream.empty,
  };
  return { orchestration, renamed };
}

describe("bot profile updates", () => {
  it.effect("renames main and sub-bots, updates T3 project titles, and refreshes roster", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
      const host = makeHost();

      yield* ensureMainBotInStateDir(stateDir);
      yield* store.upsertHome(MAIN_BOT_ID, { homeThreadId: "home", projectId: "proj-main" });

      const subA = yield* createBotInStateDir(stateDir, {
        name: "Researcher",
        summary: "Reads docs.",
      });
      const subB = yield* createBotInStateDir(stateDir, {
        name: "Writer",
        summary: "Drafts posts.",
      });
      yield* store.upsertHome(subA.id, { homeThreadId: null, projectId: "proj-sub-a" });
      yield* store.upsertHome(subB.id, { homeThreadId: null, projectId: "proj-sub-b" });

      const renamedMain = yield* updateBotProfile(
        { stateDir, store, orchestration: host.orchestration },
        MAIN_BOT_ID,
        { name: "Chief of Staff" },
      );
      expect(renamedMain.name).toBe("Chief of Staff");

      const renamedSub = yield* updateBotProfile(
        { stateDir, store, orchestration: host.orchestration },
        subA.id,
        { name: "Analyst" },
      );
      expect(renamedSub.name).toBe("Analyst");
      expect(host.renamed).toEqual([
        { projectId: "proj-main", title: "Chief of Staff" },
        { projectId: "proj-sub-a", title: "Analyst" },
      ]);

      const mainAgents = yield* fs.readFileString(
        path.join(stateDir, "bots", MAIN_BOT_ID, "workspace", "AGENTS.md"),
      );
      expect(mainAgents).toContain("| Analyst: Reads docs. | proj-sub-a |");

      const subAgents = yield* fs.readFileString(path.join(subA.path, "workspace", "AGENTS.md"));
      expect(subAgents).toContain("# Analyst");

      const emptyErr = yield* Effect.flip(
        updateBotProfile({ stateDir, store, orchestration: host.orchestration }, MAIN_BOT_ID, {
          name: "   ",
        }),
      );
      expect(emptyErr._tag).toBe("BotProfileValidationError");

      const duplicateErr = yield* Effect.flip(
        updateBotProfile({ stateDir, store, orchestration: host.orchestration }, subA.id, {
          name: "writer",
        }),
      );
      expect(duplicateErr._tag).toBe("BotProfileValidationError");

      const missingErr = yield* Effect.flip(
        updateBotProfile({ stateDir, store, orchestration: host.orchestration }, "no-such-bot", {
          name: "Valid",
        }),
      );
      expect(missingErr._tag).toBe("BotNotFoundError");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("changes a sub-bot's summary without renaming it and refreshes the roster", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
      const host = makeHost();
      const deps = { stateDir, store, orchestration: host.orchestration };

      yield* ensureMainBotInStateDir(stateDir);
      const sub = yield* createBotInStateDir(stateDir, { name: "Researcher", summary: "Reads." });
      yield* store.upsertHome(sub.id, { homeThreadId: null, projectId: "proj-sub" });

      const updated = yield* updateBotProfile(deps, sub.id, { summary: "  查资料，写摘要。 " });
      expect(updated).toMatchObject({ name: "Researcher", summary: "查资料，写摘要。" });
      expect(host.renamed).toEqual([]);

      const mainAgents = yield* fs.readFileString(
        path.join(stateDir, "bots", MAIN_BOT_ID, "workspace", "AGENTS.md"),
      );
      expect(mainAgents).toContain("| Researcher: 查资料，写摘要。 | proj-sub |");
      const subAgents = yield* fs.readFileString(path.join(sub.path, "workspace", "AGENTS.md"));
      expect(subAgents).toContain("查资料，写摘要。");

      const tooLong = yield* Effect.flip(
        updateBotProfile(deps, sub.id, { summary: "x".repeat(501) }),
      );
      expect(tooLong._tag).toBe("BotProfileValidationError");
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
