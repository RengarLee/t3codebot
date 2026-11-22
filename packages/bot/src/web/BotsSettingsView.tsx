import { useEffect, useState } from "react";

import type { BotSummary } from "../contracts.ts";
import { fetchBotList, subscribeBotsServerStateChanged } from "./apiClient.ts";
import { createBotTranslator } from "./i18n.ts";

export interface BotsListSectionProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
}

export function BotsListSection({ locale, httpBaseUrl }: BotsListSectionProps) {
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

  return (
    <div className="mt-2 space-y-3 pb-2" data-testid="settings-bots-list-section">
      <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
        <div className="font-medium text-foreground">
          {t("bots.list.title")} ({bots.length})
        </div>
        {bots.length === 0 ? (
          <p className="text-muted-foreground">{t("bots.empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {bots.map((bot) => (
              <li
                key={bot.id}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{bot.name}</div>
                  {bot.summary ? (
                    <div className="truncate text-[11px] text-muted-foreground">{bot.summary}</div>
                  ) : null}
                </div>
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {bot.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
