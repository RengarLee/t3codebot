import type * as Path from "effect/Path";

import { BOT_SHARED_DIR_NAME, type SkillScope } from "../contracts.ts";

/** The two skill folders one bot reads, and its id (the folder name under `<stateDir>/bots/`). */
export interface BotSkillRoots {
  readonly botId: string;
  readonly sharedDir: string;
  readonly ownDir: string;
}

export function sharedSkillsRoot(path: Path.Path, botsDir: string): string {
  return path.join(botsDir, BOT_SHARED_DIR_NAME, "skills");
}

/** A bot id is its folder name, so it must not name anything but one direct child of `bots/`. */
export function isSafeBotId(botId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(botId) && !botId.includes("..");
}

/** Null for an id that could escape `bots/`. */
export function skillScopeRoot(path: Path.Path, botsDir: string, scope: SkillScope): string | null {
  if (scope.scope === "shared") return sharedSkillsRoot(path, botsDir);
  return isSafeBotId(scope.botId) ? path.join(botsDir, scope.botId, "skills") : null;
}

/** `bot.path` is `<stateDir>/bots/<id>`. */
export function botSkillRoots(
  path: Path.Path,
  bot: { readonly id: string; readonly path: string },
): BotSkillRoots {
  return {
    botId: bot.id,
    sharedDir: sharedSkillsRoot(path, path.dirname(bot.path)),
    ownDir: path.join(bot.path, "skills"),
  };
}

export function parseSkillScopeKey(scopeKey: string): SkillScope {
  return scopeKey === "shared"
    ? { scope: "shared" }
    : { scope: "bot", botId: scopeKey.slice("bot:".length) };
}
