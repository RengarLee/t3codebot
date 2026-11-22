import * as Path from "effect/Path";
import * as Effect from "effect/Effect";

export interface BotStoragePaths {
  readonly directory: string;
  readonly sqlitePath: string;
  readonly configPath: string;
}

/**
 * Resolves isolated persistence paths for the bot module under T3 Code's state directory.
 * Keeping bot storage in `<stateDir>/bots/` avoids colliding with upstream `statev2.sqlite`
 * migrations and keeps user bots local (never committed to git).
 */
export const resolveBotStoragePaths = Effect.fn("bot.resolveStoragePaths")(function* (
  stateDir: string,
) {
  const path = yield* Path.Path;
  const directory = path.join(stateDir, "bots");
  return {
    directory,
    sqlitePath: path.join(directory, "bots.sqlite"),
    configPath: path.join(directory, "bots-config.json"),
  } satisfies BotStoragePaths;
});
