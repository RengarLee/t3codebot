import type { ReactElement, ReactNode } from "react";

import { MAIN_BOT_ID, type BotSummary } from "../contracts.ts";

import { useBotList } from "./botList.ts";
import { createBotTranslator } from "./i18n.ts";
import { useOpenBotHome } from "./openBotHome.ts";

export interface SidebarMainBotEntryProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  /** Project of the thread the host has open; the main bot shows as current when it owns it. */
  readonly activeProjectId: string | null;
  /** Host navigation to a T3 thread in the environment the main bot belongs to. */
  readonly onOpenThread: (threadId: string) => void;
  /** Host hover card around the row, like the host's thread hover card. */
  readonly renderBotRow: (row: ReactElement, bot: BotSummary) => ReactNode;
  /** Host trailing badges (e.g. active session status pills). */
  readonly renderBotTrailing: (bot: BotSummary) => ReactNode;
}

/** The sidebar's only bot entry. Sub-bots stay in the background and are managed in Settings. */
export function SidebarMainBotEntry({
  locale,
  httpBaseUrl,
  activeProjectId,
  onOpenThread,
  renderBotRow,
  renderBotTrailing,
}: SidebarMainBotEntryProps) {
  const t = createBotTranslator(locale);
  // The server creates the main bot on first list, so it can be missing only while that loads.
  const mainBot = useBotList(httpBaseUrl).find((bot) => bot.id === MAIN_BOT_ID);
  const { openHome, openingBotId, failedBotId } = useOpenBotHome(httpBaseUrl, onOpenThread);
  const current =
    mainBot !== undefined && mainBot.projectId !== null && mainBot.projectId === activeProjectId;

  const row = (
    <button
      type="button"
      data-testid="sidebar-main-bot"
      aria-current={current ? "page" : undefined}
      disabled={openingBotId !== null}
      onClick={() => void openHome(MAIN_BOT_ID, mainBot?.projectId ?? null)}
      className={`flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default ${
        current
          ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
          : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      } ${openingBotId !== null ? "opacity-60" : ""}`}
    >
      <BotIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
      <span className="min-w-0 flex-1 truncate font-medium">{t("bots.main.title")}</span>
      {mainBot === undefined ? null : renderBotTrailing(mainBot)}
    </button>
  );

  return (
    <div data-testid="sidebar-bots-content">
      {mainBot === undefined ? row : renderBotRow(row, mainBot)}
      {failedBotId === MAIN_BOT_ID ? (
        <p className="px-(--sidebar-row-content-inset) pb-1 text-xs text-destructive">
          {t("bots.home.openFailed")}
        </p>
      ) : null}
    </div>
  );
}

// Inline so the bot web entry needs no icon library of its own; paths match lucide's.
function BotIcon({ className }: { readonly className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
