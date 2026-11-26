import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { BUILTIN_SKILL_NAMES, MAIN_BOT_ID, type SkillInboxEntry } from "../contracts.ts";
import { openBotStore } from "./db.ts";
import { applyThreadLifecycleEvent } from "./eventSync.ts";
import { refreshBotsForSkills } from "./instructions.ts";
import type {
  BotHostOrchestrationShape,
  BotHostSendMessageInput,
  BotHostSyncProjectFoldersInput,
} from "./host.ts";
import { createBotInStateDir, ensureMainBotInStateDir } from "./registry.ts";
import { reconcileScope, SKILL_INBOX_TTL_MS, SKILL_SETTLE_MS } from "./skillReconciler.ts";
import {
  acceptSuggestion,
  deleteSkill,
  dismissSuggestion,
  installBuiltinSkills,
  listSkills,
  listSuggestions,
  parseSkillDescription,
  restoreSkill,
  runSkillCommand,
  saveSkill,
  skillHistory,
  skillRevision,
  type SkillCommandDeps,
} from "./skills.ts";

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const SHARED = { scope: "shared" } as const;
const MAIN = { scope: "bot", botId: MAIN_BOT_ID } as const;

const SKILL_V1 = "---\nname: demo\ndescription: Does the demo.\n---\n\n1. Step one.\n";
const SKILL_V2 =
  "---\nname: demo\ndescription: Does the demo.\n---\n\n1. Step one.\n2. Step two.\n";

/** A fixed "now" so file ages are exact. */
const NOW_MS = 1_790_000_000_000;

const setup = Effect.gen(function* () {
  yield* TestClock.setTime(NOW_MS);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fs.makeTempDirectoryScoped();
  const store = yield* openBotStore(path.join(stateDir, "bots", "bots.sqlite"));
  yield* ensureMainBotInStateDir(stateDir);
  const helper = yield* createBotInStateDir(stateDir, { name: "Helper", id: "helper" });
  yield* store.upsertHome(MAIN_BOT_ID, { homeThreadId: "main-home", projectId: "p-main" });
  yield* store.upsertHome("helper", { homeThreadId: null, projectId: "p-helper" });

  const sent: Array<BotHostSendMessageInput> = [];
  const synced: Array<BotHostSyncProjectFoldersInput> = [];
  const orchestration: BotHostOrchestrationShape = {
    ensureProject: ({ workspaceRoot }) => Effect.succeed({ projectId: `project:${workspaceRoot}` }),
    syncProjectFolders: (input) =>
      Effect.sync(() => {
        synced.push(input);
      }),
    updateProjectTitle: () => Effect.void,
    getThread: (threadId) =>
      Effect.succeed({
        threadId,
        projectId: threadId.startsWith("helper") ? "p-helper" : "p-main",
        title: threadId,
      }),
    launchThread: () => Effect.die("unused"),
    sendMessage: (input) =>
      Effect.sync(() => {
        sent.push(input);
        return { threadId: input.threadId, messageId: "m", sequence: sent.length };
      }),
    settleThread: () => Effect.void,
    readRunResult: () => Effect.succeed(null),
    readThreadMessages: () => Effect.succeed(null),
    subscribeThreadEvents: () => Stream.empty,
  };
  const deps: SkillCommandDeps = {
    stateDir,
    store,
    orchestration,
    ensureHome: (botId) =>
      Effect.succeed({ homeThreadId: botId === MAIN_BOT_ID ? "main-home" : `${botId}-home` }),
  };
  const botsDir = path.join(stateDir, "bots");
  const roots = {
    shared: path.join(botsDir, "_shared", "skills"),
    main: path.join(botsDir, MAIN_BOT_ID, "skills"),
    helper: path.join(botsDir, "helper", "skills"),
  };
  return { fs, path, stateDir, store, deps, roots, sent, synced, orchestration, helper };
});

/** Writes `<root>/<name>/SKILL.md` with its mtime `ageMs` in the past. */
const putSkill = Effect.fn("test.putSkill")(function* (
  root: string,
  name: string,
  content: string,
  ageMs = SKILL_SETTLE_MS * 10,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, name, "SKILL.md");
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, content);
  // utimes takes seconds when given a number.
  const when = ((yield* Clock.currentTimeMillis) - ageMs) / 1000;
  yield* fs.utimes(file, when, when);
  return file;
});

const putInbox = Effect.fn("test.putInbox")(function* (
  root: string,
  id: string,
  entry: SkillInboxEntry | string,
  ageMs = 0,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, ".inbox", `${id}.json`);
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, typeof entry === "string" ? entry : JSON.stringify(entry));
  // utimes takes seconds when given a number.
  const when = ((yield* Clock.currentTimeMillis) - ageMs) / 1000;
  yield* fs.utimes(file, when, when);
  return file;
});

const change = (name: string, extra: Partial<Extract<SkillInboxEntry, { kind: "change" }>> = {}) =>
  ({
    kind: "change",
    name,
    basis: "user_request",
    reason: "The user wanted a second step.",
    botId: MAIN_BOT_ID,
    ...extra,
  }) satisfies SkillInboxEntry;

const suggest = (name: string) =>
  ({
    kind: "suggest",
    name,
    action: "update",
    signal: "correction",
    message: "Always add step two.",
    botId: "helper",
  }) satisfies SkillInboxEntry;

describe("bot skill store", () => {
  it.effect("numbers revisions per skill and refuses a revision number twice", () =>
    Effect.gen(function* () {
      const { store } = yield* setup;
      const base = {
        scopeKey: "shared",
        content: "a",
        contentHash: "h",
        trigger: "external",
        reason: "",
        threadId: null,
        botId: null,
        suggestionId: null,
      } as const;
      yield* store.insertSkillRevision({
        ...base,
        skill: "one",
        revision: 1,
        parentRevision: null,
      });
      yield* store.insertSkillRevision({ ...base, skill: "one", revision: 2, parentRevision: 1 });
      yield* store.insertSkillRevision({
        ...base,
        skill: "two",
        revision: 1,
        parentRevision: null,
      });
      yield* store.insertSkillRevision({
        ...base,
        scopeKey: "bot:x",
        skill: "one",
        revision: 1,
        parentRevision: null,
      });

      const clash = yield* Effect.flip(
        store.insertSkillRevision({ ...base, skill: "one", revision: 2, parentRevision: 1 }),
      );
      expect(clash._tag).toBe("BotStoreError");
      expect((yield* store.latestSkillRevision("shared", "one"))?.revision).toBe(2);
      expect(
        (yield* store.listLatestSkillRevisions("shared")).map((r) => [r.skill, r.revision]),
      ).toEqual([
        ["one", 2],
        ["two", 1],
      ]);
      expect((yield* store.listSkillRevisions("shared", "one")).map((r) => r.revision)).toEqual([
        2, 1,
      ]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});

describe("bot skill commands", () => {
  it.effect("rejects a save that was based on a stale revision", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup;
      const created = yield* saveSkill(deps, {
        scope: SHARED,
        name: "demo",
        content: SKILL_V1,
        reason: "",
        expectedRevision: null,
      });
      expect(created.revision).toMatchObject({
        revision: 1,
        parentRevision: null,
        trigger: "user_manual",
        reason: "Edited by hand",
        deleted: false,
      });

      const second = yield* saveSkill(deps, {
        scope: SHARED,
        name: "demo",
        content: SKILL_V2,
        reason: "Added step two",
        expectedRevision: 1,
      });
      expect(second.revision).toMatchObject({ revision: 2, parentRevision: 1 });

      const stale = yield* Effect.flip(
        saveSkill(deps, {
          scope: SHARED,
          name: "demo",
          content: "other",
          reason: "",
          expectedRevision: 1,
        }),
      );
      expect(stale._tag).toBe("SkillConflictError");
      const createAgain = yield* Effect.flip(
        saveSkill(deps, {
          scope: SHARED,
          name: "demo",
          content: "other",
          reason: "",
          expectedRevision: null,
        }),
      );
      expect(createAgain._tag).toBe("SkillConflictError");

      // Saving what is already there is not a change.
      const same = yield* saveSkill(deps, {
        scope: SHARED,
        name: "demo",
        content: SKILL_V2,
        reason: "",
        expectedRevision: 2,
      });
      expect(same.revision.revision).toBe(2);
      expect((yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions).toHaveLength(
        2,
      );
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect(
    "deletes with a tombstone, restores an older revision, and only ever grows the history",
    () =>
      Effect.gen(function* () {
        const { deps, roots, fs, path } = yield* setup;
        yield* saveSkill(deps, {
          scope: SHARED,
          name: "demo",
          content: SKILL_V1,
          reason: "",
          expectedRevision: null,
        });
        yield* saveSkill(deps, {
          scope: SHARED,
          name: "demo",
          content: SKILL_V2,
          reason: "",
          expectedRevision: 1,
        });

        const deleted = yield* deleteSkill(deps, {
          scope: SHARED,
          name: "demo",
          reason: "",
          expectedRevision: 2,
        });
        expect(deleted.revision).toMatchObject({
          revision: 3,
          deleted: true,
          reason: "Deleted by hand",
        });
        expect(yield* fs.exists(path.join(roots.shared, "demo"))).toBe(false);
        expect((yield* listSkills(deps, SHARED)).skills).toMatchObject([
          { name: "demo", revision: 3, deleted: true },
        ]);
        const tombstone = yield* skillRevision(deps, { scope: SHARED, name: "demo", revision: 3 });
        expect(tombstone.revision.content).toBeNull();

        const cannotRestoreDeletion = yield* Effect.flip(
          restoreSkill(deps, { scope: SHARED, name: "demo", revision: 3, expectedRevision: 3 }),
        );
        expect(cannotRestoreDeletion._tag).toBe("SkillValidationError");

        const restored = yield* restoreSkill(deps, {
          scope: SHARED,
          name: "demo",
          revision: 1,
          expectedRevision: 3,
        });
        expect(restored.revision).toMatchObject({
          revision: 4,
          parentRevision: 3,
          trigger: "user_manual",
          reason: "Restored revision 1",
          deleted: false,
        });
        expect(yield* fs.readFileString(path.join(roots.shared, "demo", "SKILL.md"))).toBe(
          SKILL_V1,
        );
        expect(
          (yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions.map(
            (r) => r.revision,
          ),
        ).toEqual([4, 3, 2, 1]);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("turns a bad body, an unknown command, and an unknown skill into typed failures", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup;
      expect((yield* Effect.flip(runSkillCommand(deps, "list", { nope: 1 })))._tag).toBe(
        "SkillValidationError",
      );
      expect((yield* Effect.flip(runSkillCommand(deps, "frobnicate", {})))._tag).toBe(
        "SkillNotFoundError",
      );
      expect(
        (yield* Effect.flip(runSkillCommand(deps, "history", { scope: SHARED, name: "ghost" })))
          ._tag,
      ).toBe("SkillNotFoundError");
      expect(
        (yield* Effect.flip(
          runSkillCommand(deps, "list", { scope: { scope: "bot", botId: "../x" } }),
        ))._tag,
      ).toBe("SkillNotFoundError");
      expect(yield* runSkillCommand(deps, "list", { scope: MAIN })).toEqual({ skills: [] });
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it("reads the description from the front matter", () => {
    expect(parseSkillDescription(SKILL_V1)).toBe("Does the demo.");
    expect(parseSkillDescription("---\ndescription: >\n  Folded\n  text\n---\nbody")).toBe(
      "Folded text",
    );
    expect(parseSkillDescription('---\ndescription: "Quoted"\n---\n')).toBe("Quoted");
    expect(parseSkillDescription("# No front matter")).toBe("");
  });
});

describe("bot skill reconciler", () => {
  it.effect("records a settled edit nobody explained as external, and waits for a fresh one", () =>
    Effect.gen(function* () {
      const { deps, roots } = yield* setup;
      // Still being written: the entry may not have landed yet, so this pass leaves it.
      yield* putSkill(roots.shared, "fresh", SKILL_V1, 1_000);
      yield* putSkill(roots.shared, "settled", SKILL_V1, SKILL_SETTLE_MS + 5_000);
      yield* reconcileScope(deps, SHARED, { threadId: "t1" });
      expect((yield* listSkills(deps, SHARED)).skills.map((s) => s.name)).toEqual(["settled"]);

      const first = yield* skillHistory(deps, { scope: SHARED, name: "settled" });
      expect(first.revisions).toMatchObject([
        { revision: 1, trigger: "external", reason: "", threadId: null, botId: null },
      ]);

      // The next pass settles the fresh one once it is old enough.
      yield* putSkill(roots.shared, "fresh", SKILL_V1, SKILL_SETTLE_MS + 5_000);
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect((yield* listSkills(deps, SHARED)).skills.map((s) => s.name)).toEqual([
        "fresh",
        "settled",
      ]);

      // A change in line endings alone is not an edit.
      yield* putSkill(roots.shared, "settled", SKILL_V1.replaceAll("\n", "\r\n"));
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect(
        (yield* skillHistory(deps, { scope: SHARED, name: "settled" })).revisions,
      ).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect(
    "gives an edit its entry's basis, reason, bot, and thread, then consumes the entry",
    () =>
      Effect.gen(function* () {
        const { deps, roots, fs } = yield* setup;
        yield* putSkill(roots.main, "demo", SKILL_V1);
        yield* reconcileScope(deps, MAIN, { threadId: null });

        // The entry comes first; the edit is only a second old, which would normally wait.
        const entryFile = yield* putInbox(roots.main, "e1", change("demo"));
        yield* putSkill(roots.main, "demo", SKILL_V2, 1_000);
        yield* reconcileScope(deps, MAIN, { threadId: "thread-7" });

        expect(
          (yield* skillHistory(deps, { scope: MAIN, name: "demo" })).revisions[0],
        ).toMatchObject({
          revision: 2,
          parentRevision: 1,
          trigger: "user_request",
          reason: "The user wanted a second step.",
          botId: MAIN_BOT_ID,
          threadId: "thread-7",
        });
        expect(yield* fs.exists(entryFile)).toBe(false);

        // An entry whose edit never came waits, then expires.
        const waiting = yield* putInbox(roots.main, "e2", change("demo"));
        const expired = yield* putInbox(
          roots.main,
          "e3",
          change("other"),
          SKILL_INBOX_TTL_MS + 1_000,
        );
        yield* reconcileScope(deps, MAIN, { threadId: null });
        expect(yield* fs.exists(waiting)).toBe(true);
        expect(yield* fs.exists(expired)).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("records a removed skill as a tombstone and a returning file as a new revision", () =>
    Effect.gen(function* () {
      const { deps, roots, fs, path } = yield* setup;
      yield* putSkill(roots.shared, "demo", SKILL_V1);
      yield* reconcileScope(deps, SHARED, { threadId: null });
      yield* putInbox(roots.shared, "gone", change("demo", { reason: "Obsolete." }));
      yield* fs.remove(path.join(roots.shared, "demo"), { recursive: true });
      yield* reconcileScope(deps, SHARED, { threadId: "t2" });

      const history = yield* skillHistory(deps, { scope: SHARED, name: "demo" });
      expect(history.revisions[0]).toMatchObject({
        revision: 2,
        deleted: true,
        trigger: "user_request",
        reason: "Obsolete.",
        threadId: "t2",
      });
      // Reconciling again changes nothing.
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect((yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions).toHaveLength(
        2,
      );

      yield* putSkill(roots.shared, "demo", SKILL_V2);
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect(
        (yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions[0],
      ).toMatchObject({ revision: 3, parentRevision: 2, trigger: "external", deleted: false });
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("deletes inbox files that do not parse", () =>
    Effect.gen(function* () {
      const { deps, roots, fs } = yield* setup;
      const junk = yield* putInbox(roots.shared, "junk", "{ not json");
      const wrongShape = yield* putInbox(
        roots.shared,
        "shape",
        JSON.stringify({ kind: "change", name: "Bad Name", basis: "user_request" }),
      );
      const notAnEntry = yield* putInbox(roots.shared, "other", JSON.stringify({ hello: "world" }));
      const good = yield* putInbox(roots.shared, "good", change("demo"));
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect(yield* fs.exists(junk)).toBe(false);
      expect(yield* fs.exists(wrongShape)).toBe(false);
      expect(yield* fs.exists(notAnEntry)).toBe(false);
      expect(yield* fs.exists(good)).toBe(true);
      expect((yield* listSuggestions(deps)).suggestions).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("is a no-op for a scope whose folder does not exist", () =>
    Effect.gen(function* () {
      const { deps, store } = yield* setup;
      yield* reconcileScope(deps, SHARED, { threadId: null });
      expect(yield* store.listLatestSkillRevisions("shared")).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});

describe("bot skill suggestions", () => {
  it.effect(
    "turns a suggest entry into a pending suggestion, once, and lets the user dismiss it",
    () =>
      Effect.gen(function* () {
        const { deps, roots, fs } = yield* setup;
        const file = yield* putInbox(roots.shared, "s-1", suggest("demo"));
        yield* reconcileScope(deps, SHARED, { threadId: "helper-thread" });
        expect(yield* fs.exists(file)).toBe(false);
        // The same entry written again under the same id is not a second suggestion.
        yield* putInbox(roots.shared, "s-1", suggest("demo"));
        yield* reconcileScope(deps, SHARED, { threadId: null });

        const { suggestions } = yield* listSuggestions(deps);
        expect(suggestions).toMatchObject([
          {
            id: "s-1",
            scope: { scope: "shared" },
            name: "demo",
            action: "update",
            signal: "correction",
            message: "Always add step two.",
            botId: "helper",
            threadId: "helper-thread",
            status: "pending",
            decidedAt: null,
          },
        ]);

        const dismissed = yield* dismissSuggestion(deps, "s-1");
        expect(dismissed.suggestion.status).toBe("dismissed");
        const again = yield* dismissSuggestion(deps, "s-1");
        expect(again.suggestion).toEqual(dismissed.suggestion);
        expect((yield* listSuggestions(deps)).suggestions).toEqual([]);
        expect((yield* Effect.flip(dismissSuggestion(deps, "nope")))._tag).toBe(
          "SkillNotFoundError",
        );
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect(
    "sends one message on accept and flips to accepted only when the edit is recorded",
    () =>
      Effect.gen(function* () {
        const { deps, roots, sent, store } = yield* setup;
        yield* putSkill(roots.shared, "demo", SKILL_V1);
        yield* reconcileScope(deps, SHARED, { threadId: null });
        yield* putInbox(roots.shared, "s-2", suggest("demo"));
        yield* reconcileScope(deps, SHARED, { threadId: "helper-thread" });

        const accepted = yield* acceptSuggestion(deps, "s-2");
        expect(accepted.suggestion.status).toBe("pending");
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
          threadId: "helper-home",
          clientRequestId: "bot:skill-suggestion:s-2",
        });
        expect(sent[0]?.text).toContain("suggestion s-2");
        expect(sent[0]?.text).toContain('"demo"');
        expect(sent[0]?.text).toContain("Always add step two.");
        expect(sent[0]?.text).toContain("skill-improver");
        expect(sent[0]?.text).toContain(roots.shared);
        // A double click reuses the request id, so the host delivers it once.
        yield* acceptSuggestion(deps, "s-2");
        expect(new Set(sent.map((m) => m.clientRequestId))).toEqual(
          new Set(["bot:skill-suggestion:s-2"]),
        );
        expect((yield* store.getSkillSuggestion("s-2"))?.status).toBe("pending");

        // The bot writes its entry, then edits; its Home run ending reconciles.
        yield* putInbox(
          roots.shared,
          "c-2",
          change("demo", { basis: "suggested", suggestionId: "s-2", botId: "helper" }),
        );
        yield* putSkill(roots.shared, "demo", SKILL_V2, 500);
        yield* applyThreadLifecycleEvent(
          { stateDir: deps.stateDir, store, orchestration: deps.orchestration! },
          { type: "run_status", threadId: "helper-home", runId: "r1", status: "completed" },
        );

        expect((yield* store.getSkillSuggestion("s-2"))?.status).toBe("accepted");
        expect(
          (yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions[0],
        ).toMatchObject({
          revision: 2,
          trigger: "suggested",
          suggestionId: "s-2",
          botId: "helper",
          threadId: "helper-home",
        });
        expect((yield* Effect.flip(acceptSuggestion(deps, "s-2")))._tag).toBe("SkillConflictError");
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("cannot accept without orchestration", () =>
    Effect.gen(function* () {
      const { deps, roots } = yield* setup;
      yield* putInbox(roots.shared, "s-3", suggest("demo"));
      yield* reconcileScope(deps, SHARED, { threadId: null });
      const offline: SkillCommandDeps = { stateDir: deps.stateDir, store: deps.store };
      expect((yield* Effect.flip(acceptSuggestion(offline, "s-3")))._tag).toBe(
        "SkillUnavailableError",
      );
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});

describe("bot shared skills", () => {
  it.effect(
    "keeps one shared folder for every bot and one name per bot across it and its own",
    () =>
      Effect.gen(function* () {
        const { deps, roots, fs, path, stateDir, store } = yield* setup;
        yield* saveSkill(deps, {
          scope: SHARED,
          name: "demo",
          content: SKILL_V1,
          reason: "",
          expectedRevision: null,
        });
        yield* saveSkill(deps, {
          scope: MAIN,
          name: "mine",
          content: SKILL_V1,
          reason: "",
          expectedRevision: null,
        });
        expect((yield* listSkills(deps, MAIN)).skills.map((s) => s.name)).toEqual(["mine"]);
        expect(
          (yield* listSkills(deps, { scope: "bot", botId: "helper" })).skills.map((s) => s.name),
        ).toEqual([]);
        expect((yield* listSkills(deps, SHARED)).skills.map((s) => s.name)).toEqual(["demo"]);

        // The same name in a bot's own folder and the shared one is a clash, either way round.
        const botClash = yield* Effect.flip(
          saveSkill(deps, {
            scope: { scope: "bot", botId: "helper" },
            name: "demo",
            content: SKILL_V1,
            reason: "",
            expectedRevision: null,
          }),
        );
        expect(botClash._tag).toBe("SkillValidationError");
        const sharedClash = yield* Effect.flip(
          saveSkill(deps, {
            scope: SHARED,
            name: "mine",
            content: SKILL_V1,
            reason: "",
            expectedRevision: null,
          }),
        );
        expect(sharedClash._tag).toBe("SkillValidationError");
        expect(yield* fs.exists(path.join(roots.helper, "demo"))).toBe(false);

        // Both bots' instructions name the same shared folder.
        yield* refreshBotsForSkills({ stateDir, store, orchestration: deps.orchestration });
        yield* ensureMainBotInStateDir(stateDir, yield* store.getHomesByBot());
        for (const botId of [MAIN_BOT_ID, "helper"]) {
          const agents = yield* fs.readFileString(
            path.join(stateDir, "bots", botId, "workspace", "AGENTS.md"),
          );
          expect(agents).toContain(roots.shared);
          expect(agents).toContain("skill-improver");
          expect(agents).toContain("Skills change only with the user's OK");
        }

        // A run ending in either bot's project records an edit to the shared folder.
        yield* putInbox(roots.shared, "c-1", change("demo", { botId: "helper" }));
        yield* putSkill(roots.shared, "demo", SKILL_V2, 500);
        yield* applyThreadLifecycleEvent(
          { stateDir, store, orchestration: deps.orchestration! },
          { type: "run_status", threadId: "helper-session", runId: "r9", status: "completed" },
        );
        expect(
          (yield* skillHistory(deps, { scope: SHARED, name: "demo" })).revisions[0],
        ).toMatchObject({
          revision: 2,
          trigger: "user_request",
          botId: "helper",
          threadId: "helper-session",
        });
      }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("writes the built-in skill once and never overwrites or revives it", () =>
    Effect.gen(function* () {
      const { deps, roots, fs, path } = yield* setup;
      const file = path.join(roots.shared, "skill-improver", "SKILL.md");

      yield* installBuiltinSkills(deps);
      const shipped = yield* fs.readFileString(file);
      expect(shipped).toContain("name: skill-improver");
      expect(shipped).toContain('"kind": "suggest"');
      expect(shipped).toContain('"kind": "change"');
      expect((yield* listSkills(deps, SHARED)).skills).toMatchObject([
        { name: "skill-improver", revision: 1, builtin: true, deleted: false },
      ]);
      expect(
        (yield* skillHistory(deps, { scope: SHARED, name: "skill-improver" })).revisions,
      ).toMatchObject([{ revision: 1, trigger: "builtin", botId: null }]);
      expect(BUILTIN_SKILL_NAMES).toContain("skill-improver");

      // An edited copy stays as it is, and installing again adds nothing.
      yield* saveSkill(deps, {
        scope: SHARED,
        name: "skill-improver",
        content: "# My own version\n",
        reason: "Mine now",
        expectedRevision: 1,
      });
      yield* installBuiltinSkills(deps);
      expect(yield* fs.readFileString(file)).toBe("# My own version\n");
      expect(
        (yield* skillHistory(deps, { scope: SHARED, name: "skill-improver" })).revisions,
      ).toHaveLength(2);

      // Deleting it is the user's call; it stays deleted, and can be restored.
      yield* deleteSkill(deps, {
        scope: SHARED,
        name: "skill-improver",
        reason: "",
        expectedRevision: 2,
      });
      yield* installBuiltinSkills(deps);
      expect(yield* fs.exists(file)).toBe(false);
      yield* restoreSkill(deps, {
        scope: SHARED,
        name: "skill-improver",
        revision: 1,
        expectedRevision: 3,
      });
      expect(yield* fs.readFileString(file)).toBe(shipped);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );

  it.effect("grants every bot's project both skill folders and refreshes existing sub-bots", () =>
    Effect.gen(function* () {
      const { deps, roots, fs, path, stateDir, store, synced, helper } = yield* setup;
      const stale = path.join(helper.path, "workspace", "AGENTS.md");
      yield* fs.writeFileString(stale, "# Helper\n\nOld instructions.\n");

      yield* refreshBotsForSkills({ stateDir, store, orchestration: deps.orchestration });
      expect(yield* fs.readFileString(stale)).toContain(roots.shared);
      expect(synced.map((s) => [s.projectId, s.folders.map((f) => f.path)])).toEqual([
        ["p-helper", [roots.shared, roots.helper]],
        ["p-main", [roots.shared, roots.main]],
      ]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
