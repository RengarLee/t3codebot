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
  it.effect("keeps each bot's Home binding and latest session receipts apart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped();
      const store = yield* openBotStore(path.join(tempDir, "bots", "bots.sqlite"));

      yield* store.upsertHome("main", { homeThreadId: "thread:home", projectId: "project:main" });
      yield* store.upsertHome("sub", { homeThreadId: null, projectId: "project:sub" });
      expect(yield* store.getHomesByBot()).toEqual(
        new Map([
          ["main", { projectId: "project:main", homeThreadId: "thread:home" }],
          ["sub", { projectId: "project:sub", homeThreadId: null }],
        ]),
      );

      yield* store.upsertSessionReceipt("main", "thread:a", {
        status: "blocked",
        outcome: "Waiting on access.",
        artifacts: [],
      });
      yield* store.upsertSessionReceipt("main", "thread:a", {
        status: "done",
        outcome: "Shipped.",
        artifacts: ["docs/report.md"],
      });
      yield* store.upsertSessionReceipt("sub", "thread:b", {
        status: "done",
        outcome: "Other bot.",
        artifacts: [],
      });
      const receipts = yield* store.listSessionReceipts("main");
      expect(receipts.map(({ receivedAt: _receivedAt, ...receipt }) => receipt)).toEqual([
        {
          threadId: "thread:a",
          status: "done",
          outcome: "Shipped.",
          artifacts: ["docs/report.md"],
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(nodeLayer)),
  );
});
