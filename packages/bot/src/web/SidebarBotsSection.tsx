import { useState, type ReactElement, type ReactNode } from "react";

import type { BotSummary } from "../contracts.ts";

import { ensureBotHome, notifyBotsServerStateChanged } from "./apiClient.ts";
import { useBotList } from "./botList.ts";
import { createBotTranslator } from "./i18n.ts";

export interface SidebarBotsSectionProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Project of the thread the host has open; the bot that owns it shows as current. */
  readonly activeProjectId: string | null;
  /** Host navigation to a T3 thread in the environment these bots belong to. */
  readonly onOpenThread: (threadId: string) => void;
  /** Host icon for a bot, so bots look like the host's project icons. */
  readonly renderBotIcon: (botName: string) => ReactNode;
  /** Host hover card around a bot row, like the host's thread hover card. */
  readonly renderBotRow: (row: ReactElement, bot: BotSummary) => ReactNode;
  /** Optional host trailing badges (e.g. active session status pills) for a bot row. */
  readonly renderBotTrailing?: (bot: BotSummary) => ReactNode;
}

/** Shaped like a project folder in the grouped sidebar: a header row over its bot rows. */
export function SidebarBotsSection({
  locale,
  httpBaseUrl,
  expanded,
  onToggleExpanded,
  activeProjectId,
  onOpenThread,
  renderBotIcon,
  renderBotRow,
  renderBotTrailing,
}: SidebarBotsSectionProps) {
  const t = createBotTranslator(locale);
  const bots = useBotList(httpBaseUrl);
  const [openingBotId, setOpeningBotId] = useState<string | null>(null);
  const [failedBotId, setFailedBotId] = useState<string | null>(null);

  const openHome = async (botId: string, knownProjectId: string | null) => {
    if (openingBotId !== null) return;
    setOpeningBotId(botId);
    setFailedBotId(null);
    try {
      const { home } = await ensureBotHome(botId, { httpBaseUrl });
      if (home.homeThreadId === null) throw new Error("Home thread missing");
      // The sidebar hides bot sessions by project, so it must learn a newly created one.
      if (home.projectId !== knownProjectId) notifyBotsServerStateChanged();
      onOpenThread(home.homeThreadId);
    } catch {
      setFailedBotId(botId);
    } finally {
      setOpeningBotId(null);
    }
  };

  return (
    <div className="group/bots-folder" data-testid="sidebar-bots-content">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <BotIcon className="size-4 shrink-0 text-sidebar-foreground/80" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          {t("bots.title")}
        </span>
        {!expanded && bots.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {bots.length}
          </span>
        ) : null}
        <ChevronDownIcon
          className={`size-3 shrink-0 text-sidebar-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded ? (
        bots.length === 0 ? (
          <p className="px-(--sidebar-row-content-inset) py-1.5 text-xs text-sidebar-muted-foreground">
            {t("bots.empty")}
          </p>
        ) : (
          <ul className="space-y-0.5" data-testid="sidebar-bots-list">
            {bots.map((bot) => {
              const current = bot.projectId !== null && bot.projectId === activeProjectId;
              return (
                <li key={bot.id}>
                  {renderBotRow(
                    <button
                      type="button"
                      aria-current={current ? "page" : undefined}
                      disabled={openingBotId !== null}
                      onClick={() => void openHome(bot.id, bot.projectId)}
                      className={`flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default ${
                        current
                          ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                      } ${openingBotId === bot.id ? "opacity-60" : ""}`}
                    >
                      {renderBotIcon(bot.name)}
                      <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                      {renderBotTrailing ? (
                        renderBotTrailing(bot)
                      ) : bot.activeTasksCount > 0 ? (
                        <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
                          {bot.activeTasksCount}
                        </span>
                      ) : null}
                    </button>,
                    bot,
                  )}
                  {failedBotId === bot.id ? (
                    <p className="px-2.5 pb-1 text-xs text-destructive">
                      {t("bots.home.openFailed")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

// Inline so the bot web entry needs no icon library of its own; paths match lucide's.
function ChevronDownIcon({ className }: { readonly className: string }) {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

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
