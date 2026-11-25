import type { ReactNode } from "react";

import type { BotSummary } from "../contracts.ts";
import type { BotTranslator } from "./i18n.ts";
import { skillErrorStatus } from "./useSkillResource.ts";

export const SKILL_BADGE_CLASS =
  "shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-xs leading-none font-medium text-muted-foreground";

export const SKILL_BUTTON_CLASS =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:cursor-default disabled:opacity-50";

export const SKILL_PRIMARY_BUTTON_CLASS =
  "inline-flex h-7 cursor-pointer items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-default disabled:opacity-50";

export const SKILL_DANGER_BUTTON_CLASS =
  "inline-flex h-7 cursor-pointer items-center rounded-lg border border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-default disabled:opacity-50";

export const SKILL_CARD_CLASS =
  "rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50";

export function skillBotName(bots: ReadonlyArray<BotSummary>, botId: string): string {
  return bots.find((bot) => bot.id === botId)?.name ?? botId;
}

/** The server's own words for a rejected name or request; anything else gets the generic line. */
export function skillErrorText(error: unknown, t: BotTranslator): string {
  const status = skillErrorStatus(error);
  if ((status === 400 || status === 404) && error instanceof Error) return error.message;
  return t("bots.skills.actionFailed");
}

export function SkillErrorLine({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="px-3 py-2 text-xs text-destructive sm:px-4">
      {children}
    </p>
  );
}
