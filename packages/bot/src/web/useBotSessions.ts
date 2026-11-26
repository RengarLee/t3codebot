// @effect-diagnostics globalTimers:off - The React subscription owns and clears its debounce timer.
import { useCallback, useEffect, useRef, useState } from "react";
import * as DateTime from "effect/DateTime";
import type { BotSessionsRequest, BotSessionsResponse } from "../contracts.ts";
import { fetchBotSessions } from "./apiClient.ts";

export function useBotSessions(
  input: Omit<BotSessionsRequest, "cursor">,
  httpBaseUrl: string | null | undefined,
  revision: string,
) {
  const [data, setData] = useState<BotSessionsResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef<{ scope: string; revision: string } | null>(null);
  const loadingMore = useRef(false);
  const { parentThreadId, descendants } = input;
  const scope = `${httpBaseUrl ?? ""}:${parentThreadId}:${descendants}`;
  const merge = useCallback(
    (page: BotSessionsResponse, initial: boolean) => {
      setData((previous) => {
        const sessions = new Map((previous?.sessions ?? []).map((s) => [s.thread.id, s]));
        if (initial) {
          const boundary = page.sessions.at(-1)?.thread;
          for (const [id, session] of sessions) {
            const order =
              boundary === undefined
                ? 0
                : DateTime.toEpochMillis(session.thread.createdAt) -
                    DateTime.toEpochMillis(boundary.createdAt) ||
                  session.thread.id.localeCompare(boundary.id);
            if (!page.hasMore || (descendants ? order <= 0 : order >= 0)) sessions.delete(id);
          }
        }
        for (const session of page.sessions) sessions.set(session.thread.id, session);
        return {
          sessions: [...sessions.values()].sort(
            (a, b) =>
              DateTime.toEpochMillis(a.thread.createdAt) -
                DateTime.toEpochMillis(b.thread.createdAt) ||
              a.thread.id.localeCompare(b.thread.id),
          ),
          hasMore:
            initial && previous !== null && !descendants
              ? previous.hasMore && page.hasMore
              : page.hasMore,
        };
      });
    },
    [descendants],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh the server query when live shell membership changes, coalescing creation events
  useEffect(() => {
    const current = { scope, revision };
    generation.current = current;
    const timer = setTimeout(() => {
      fetchBotSessions({ parentThreadId, descendants }, { httpBaseUrl }).then(
        (page) => {
          if (current !== generation.current) return;
          merge(page, true);
          setError(false);
        },
        () => {
          if (current === generation.current) setError(true);
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      generation.current = null;
    };
  }, [parentThreadId, descendants, httpBaseUrl, revision, scope, merge]);

  async function loadMore(refresh = false) {
    if (loadingMore.current) return false;
    loadingMore.current = true;
    const current = generation.current;
    const edge = refresh ? undefined : descendants ? data?.sessions.at(-1) : data?.sessions[0];
    setPending(true);
    const result = await fetchBotSessions(
      {
        parentThreadId,
        descendants,
        ...(edge === undefined
          ? {}
          : {
              cursor: {
                createdAt: DateTime.formatIso(edge.thread.createdAt),
                threadId: edge.thread.id,
              },
            }),
      },
      { httpBaseUrl },
    ).then(
      (page) => ({ page }),
      () => ({ page: null }),
    );
    loadingMore.current = false;
    if (current === null || current.scope !== generation.current?.scope) {
      return false;
    }
    if (result.page === null) setError(true);
    else {
      merge(result.page, refresh);
      setError(false);
    }
    setPending(false);
    return result.page !== null;
  }
  return { data, error, pending, loadMore };
}
