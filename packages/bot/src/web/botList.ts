// @effect-diagnostics globalTimers:off - React store outside an Effect runtime; its retry timer ends with the last subscriber.
import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { BotSummary } from "../contracts.ts";
import { fetchBotList, subscribeBotsServerStateChanged } from "./apiClient.ts";

const EMPTY_BOTS: ReadonlyArray<BotSummary> = [];

interface BotListEntry {
  bots: ReadonlyArray<BotSummary>;
  readonly listeners: Set<() => void>;
  stop: (() => void) | null;
  generation: number;
}

// One list per server so every bot surface shares a single request and refresh.
const entries = new Map<string, BotListEntry>();

function subscribeBotList(httpBaseUrl: string | null | undefined, listener: () => void) {
  const key = httpBaseUrl ?? "";
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = { bots: EMPTY_BOTS, listeners: new Set(), stop: null, generation: 0 };
    entries.set(key, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  if (current.stop === null) {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(retryTimer);
      const generation = ++current.generation;
      fetchBotList({ httpBaseUrl }).then(
        (result) => {
          if (generation !== current.generation) return;
          current.bots = result.bots;
          for (const notify of current.listeners) notify();
        },
        () => {
          // A server restart or reconnect drops the request; the sidebar filter needs the list back.
          if (generation === current.generation) retryTimer = setTimeout(load, 5_000);
        },
      );
    };
    load();
    const unsubscribe = subscribeBotsServerStateChanged(load);
    current.stop = () => {
      clearTimeout(retryTimer);
      unsubscribe();
    };
  }
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.stop?.();
    current.stop = null;
    current.generation++;
  };
}

export function useBotList(httpBaseUrl: string | null | undefined): ReadonlyArray<BotSummary> {
  const subscribe = useCallback(
    (listener: () => void) => subscribeBotList(httpBaseUrl, listener),
    [httpBaseUrl],
  );
  return useSyncExternalStore(subscribe, () => entries.get(httpBaseUrl ?? "")?.bots ?? EMPTY_BOTS);
}

/** Project ids that belong to bots; their threads are bot sessions, reached from the Bots section. */
export function useBotProjectIds(httpBaseUrl: string | null | undefined): ReadonlySet<string> {
  const bots = useBotList(httpBaseUrl);
  return useMemo(
    () => new Set(bots.flatMap((bot) => (bot.projectId === null ? [] : [bot.projectId]))),
    [bots],
  );
}
