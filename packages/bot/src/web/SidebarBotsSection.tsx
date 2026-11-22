import { useEffect, useState } from "react";

import type { BotSummary } from "../contracts.ts";
import { fetchBotList, subscribeBotsServerStateChanged } from "./apiClient.ts";
import { createBotTranslator } from "./i18n.ts";

export interface SidebarBotsListProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
}

export function SidebarBotsList({ locale, httpBaseUrl }: SidebarBotsListProps) {
  const t = createBotTranslator(locale);
  const [bots, setBots] = useState<ReadonlyArray<BotSummary>>([]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribes to /api/bots/list and bot state change events while mounted.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchBotList({ httpBaseUrl });
        if (!cancelled) {
          setBots(result.bots);
        }
      } catch {
        if (!cancelled) {
          setBots([]);
        }
      }
    };
    void load();
    const unsubscribe = subscribeBotsServerStateChanged(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [httpBaseUrl]);

  if (bots.length === 0) {
    return <p className="px-2 pb-2 text-xs text-sidebar-muted-foreground">{t("bots.empty")}</p>;
  }

  return (
    <ul className="space-y-0.5 px-1 pb-2" data-testid="sidebar-bots-list">
      {bots.map((bot) => (
        <li
          key={bot.id}
          className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent/60"
        >
          <span className="truncate font-medium">{bot.name}</span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-sidebar-muted-foreground">
            {bot.activeTasksCount > 0 ? (
              <span className="rounded bg-sidebar-accent px-1 py-0.25 text-sidebar-accent-foreground">
                {bot.activeTasksCount}
              </span>
            ) : null}
            <span>{bot.status}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
