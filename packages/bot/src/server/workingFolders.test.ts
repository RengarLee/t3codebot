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
import {
  BotHostError,
  type BotHostOrchestrationShape,
  type BotHostSyncProjectFoldersInput,
} from "./host.ts";
import {
  createBotInStateDir,
  ensureMainBotInStateDir,
  listStateDirBots,
  parseBotYaml,
  upsertYamlStringListField,
} from "./registry.ts";
import { updateBotWorkingFolders } from "./workingFolders.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

function makeHost(options?: { readonly failSync?: boolean }) {
  const projectsByRoot = new Map<string, string>();
  const synced: Array<BotHostSyncProjectFoldersInput> = [];
  const orchestration: BotHostOrchestrationShape = {
    ensureProject: ({ workspaceRoot }) =>
      Effect.sync(() => {
        const projectId = projectsByRoot.get(workspaceRoot) ?? `project:${projectsByRoot.size}`;
        projectsByRoot.set(workspaceRoot, projectId);
        return { projectId };
      }),
    syncProjectFolders: (input) =>
      options?.failSync
        ? Effect.fail(
            new BotHostError({ operation: "syncProjectFolders", detail: "sync rejected" }),
          )
        : Effect.sync(() => {
            synced.push(input);
          }),
    updateProjectTitle: () => Effect.void,
    getThread: () => Effect.succeed(null),
    launchThread: () => Effect.die("unused"),
    sendMessage: () => Effect.die("unused"),
    settleThread: () => Effect.void,
    readRunResult: () => Effect.succeed(null),
    subscribeThreadEvents: () => Stream.empty,
  };
  return { orchestration, projectsByRoot, synced };
}

describe("bot working folders", () => {
  it("upserts working_folders in bot.yaml without losing comments or other fields", () => {
    const initial = [
      "# custom comment",
      'id: "main"',
      'name: "Bot"',
      "runtime:",
      '  session_mode: "fresh_per_run"',
      "",
    ].join("\n");

    const inserted = upsertYamlStringListField(initial, "working_folders", ["/tmp/notes"]);
    expect(inserted).toContain("# custom comment");
    expect(inserted).toContain('working_folders: ["/tmp/notes"]\nruntime:');
    expect(parseBotYaml(inserted)).toMatchObject({
      id: "main",
      name: "Bot",
      workingFolders: ["/tmp/notes"],
      sessionMode: "fresh_per_run",
    });

    const replaced = upsertYamlStringListField(inserted, "working_folders", [
      "/tmp/notes",
      "/tmp/docs",
    ]);
    expect(replaced.match(/working_folders:/g)).toHaveLength(1);
    expect(parseBotYaml(replaced).workingFolders).toEqual(["/tmp/notes", "/tmp/docs"]);
  });

  it.effect(
    "updates main bot and sub-bot working folders, syncs T3 trackedFolders, and regenerates AGENTS.md",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        const host = makeHost();

        const notesDir = path.join(stateDir, "notes");
        const reportsDir = path.join(stateDir, "reports");
        const repoDir = path.join(stateDir, "repo");
        yield* fs.makeDirectory(notesDir, { recursive: true });
        yield* fs.makeDirectory(reportsDir, { recursive: true });
        yield* fs.makeDirectory(repoDir, { recursive: true });

        yield* ensureMainBotInStateDir(stateDir);
        const mainAgentsPath = path.join(stateDir, "bots", MAIN_BOT_ID, "workspace", "AGENTS.md");
        expect(yield* fs.readFileString(mainAgentsPath)).toContain(
          "Only your own workspace folder (`./`) is configured right now.",
        );

        const updatedMain = yield* updateBotWorkingFolders(
          { stateDir, store, orchestration: host.orchestration },
          MAIN_BOT_ID,
          [notesDir, reportsDir, notesDir],
        );
        expect(updatedMain.workingFolders).toEqual([notesDir, reportsDir]);
        // The project always tracks the two skill folders so the agent may write them.
        const skillFolders = [
          { path: path.join(stateDir, "bots", "_shared", "skills"), name: "shared-skills" },
          { path: path.join(stateDir, "bots", MAIN_BOT_ID, "skills"), name: "bot-skills" },
        ];
        expect(host.synced.at(-1)).toEqual({
          projectId: updatedMain.projectId!,
          folders: [
            ...skillFolders,
            { path: notesDir, name: "notes" },
            { path: reportsDir, name: "reports" },
          ],
        });
        const updatedMainAgents = yield* fs.readFileString(mainAgentsPath);
        expect(updatedMainAgents).toContain(`- \`${notesDir}\``);
        expect(updatedMainAgents).toContain(`- \`${reportsDir}\``);

        // Removing one folder still succeeds even if another kept folder disappeared on disk.
        yield* fs.remove(notesDir, { recursive: true });
        const afterRemove = yield* updateBotWorkingFolders(
          { stateDir, store, orchestration: host.orchestration },
          MAIN_BOT_ID,
          [notesDir],
        );
        expect(afterRemove.workingFolders).toEqual([notesDir]);

        // Clearing all folders restores the workspace-only guidance.
        const cleared = yield* updateBotWorkingFolders(
          { stateDir, store, orchestration: host.orchestration },
          MAIN_BOT_ID,
          [],
        );
        expect(cleared.workingFolders).toEqual([]);
        expect(yield* fs.readFileString(mainAgentsPath)).toContain(
          "Only your own workspace folder (`./`) is configured right now.",
        );

        // Sub-bot keeps its code projects table when its working folders are updated.
        const sub = yield* createBotInStateDir(stateDir, {
          name: "Editor",
          summary: "Edits drafts and docs.",
          projects: [repoDir],
        });
        const updatedSub = yield* updateBotWorkingFolders(
          { stateDir, store, orchestration: host.orchestration },
          sub.id,
          [reportsDir],
        );
        expect(updatedSub.workingFolders).toEqual([reportsDir]);
        const subAgents = yield* fs.readFileString(path.join(sub.path, "workspace", "AGENTS.md"));
        expect(subAgents).toContain(`- \`${reportsDir}\``);
        expect(subAgents).toContain(`| ${repoDir} |`);
        expect(subAgents).toContain(path.join(stateDir, "bots", "_shared", "skills"));
        expect(subAgents).toContain(path.join(sub.path, "skills"));
        expect(subAgents).toContain(`your bot id is \`${sub.id}\``);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect(
    "rejects invalid folders and keeps bot.yaml unchanged when host project sync fails",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped();
        const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
        const host = makeHost();

        const main = yield* ensureMainBotInStateDir(stateDir);
        const workspaceRoot = path.join(main.path, "workspace");
        const filePath = path.join(stateDir, "plain.txt");
        yield* fs.writeFileString(filePath, "hello");
        const validDir = path.join(stateDir, "docs");
        yield* fs.makeDirectory(validDir, { recursive: true });

        const relativeErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            ["relative/folder"],
          ),
        );
        expect(relativeErr._tag).toBe("BotWorkingFoldersValidationError");

        const missingErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            [path.join(stateDir, "does-not-exist")],
          ),
        );
        expect(missingErr._tag).toBe("BotWorkingFoldersValidationError");

        const fileErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            [filePath],
          ),
        );
        expect(fileErr._tag).toBe("BotWorkingFoldersValidationError");

        const selfErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            [workspaceRoot],
          ),
        );
        expect(selfErr._tag).toBe("BotWorkingFoldersValidationError");

        const ancestorErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            [stateDir],
          ),
        );
        expect(ancestorErr._tag).toBe("BotWorkingFoldersValidationError");

        const nestedErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            MAIN_BOT_ID,
            [path.join(workspaceRoot, "outputs")],
          ),
        );
        expect(nestedErr._tag).toBe("BotWorkingFoldersValidationError");

        const missingBotErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: host.orchestration },
            "no-such-bot",
            [validDir],
          ),
        );
        expect(missingBotErr._tag).toBe("BotNotFoundError");

        const failingHost = makeHost({ failSync: true });
        const hostErr = yield* Effect.flip(
          updateBotWorkingFolders(
            { stateDir, store, orchestration: failingHost.orchestration },
            MAIN_BOT_ID,
            [validDir],
          ),
        );
        expect(hostErr._tag).toBe("BotHostError");
        const listed = yield* listStateDirBots(stateDir);
        expect(listed.bots.find((bot) => bot.id === MAIN_BOT_ID)?.workingFolders).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
