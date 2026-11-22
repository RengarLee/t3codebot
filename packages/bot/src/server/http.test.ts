import { describe, expect, it } from "@effect/vitest";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BOT_HEALTH_ROUTE, BotHealthResponseSchema } from "../contracts.ts";
import { createBotHealthPayload } from "./http.ts";
import { resolveBotStoragePaths } from "./storage.ts";

const decodeHealthResponse = Schema.decodeSync(BotHealthResponseSchema);

describe("bot server module", () => {
  it("builds a schema-valid health payload on /api/bots/health", () => {
    expect(BOT_HEALTH_ROUTE).toBe("/api/bots/health");
    const payload = createBotHealthPayload();
    expect(decodeHealthResponse(payload)).toEqual({
      ok: true,
      module: "t3codebot",
      botsCount: 0,
    });
  });

  it.effect("isolates bot persistence paths outside upstream statev2.sqlite", () =>
    Effect.gen(function* () {
      const paths = yield* resolveBotStoragePaths("/tmp/t3-state");
      const sep = (yield* Path.Path).sep;
      expect(paths.directory).toBe(["", "tmp", "t3-state", "bots"].join(sep));
      expect(paths.sqlitePath).toContain("bots.sqlite");
      expect(paths.sqlitePath).not.toContain("statev2.sqlite");
      expect(paths.configPath).toContain("bots-config.json");
    }).pipe(Effect.provide(NodePath.layer)),
  );
});
