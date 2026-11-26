import { useEffect, useRef, useState, type ReactNode } from "react";

import { createBotTranslator } from "./i18n.ts";

const INITIAL_COUNT = 10;
const PAGE_COUNT = 25;
// Top active list shows ~8 session rows (8 * 36px + 7 * 2px = 302px) before scrolling.
const ACTIVE_LIST_MAX_HEIGHT = "19rem";
// Collapsible Working / Settled lists show ~5 rows (5 * 36px + 4 * 2px = 188px) before scrolling.
const SECTION_LIST_MAX_HEIGHT = "11.75rem";

export interface BotOverviewDropdownRow {
  readonly kind: "working" | "settled";
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Shown on the Working row when > 0 (preparing / working / waiting). */
  readonly runningCount: number;
  readonly runningLabel: string;
  readonly content: ReactNode;
}

export interface BotOverviewPanelProps {
  readonly locale: string | undefined;
  readonly header?: ReactNode;
  /** Unsettled, non-running sessions in sidebar order. Home is left out. */
  readonly activeSessionIds: ReadonlyArray<string>;
  /** Currently executing sessions (preparing / working / waiting). */
  readonly workingSessionIds: ReadonlyArray<string>;
  readonly settledSessionIds: ReadonlyArray<string>;
  readonly runningCount: number;
  /** Host thread row for one session, as an `<li>`. */
  readonly renderSession: (threadId: string, onSelect: () => void) => ReactNode;
  /** Host trigger + collapsible section matching ThreadDetailsPanel pickers. */
  readonly renderDropdownRow: (row: BotOverviewDropdownRow) => ReactNode;
}

export function BotOverviewPanel({
  locale,
  header,
  activeSessionIds,
  workingSessionIds,
  settledSessionIds,
  runningCount,
  renderSession,
  renderDropdownRow,
}: BotOverviewPanelProps) {
  const t = createBotTranslator(locale);
  const [workingOpen, setWorkingOpen] = useState(true);
  const [settledOpen, setSettledOpen] = useState(false);
  const noop = () => {};
  const empty = (
    <p className="px-2.5 py-2 text-muted-foreground text-xs">{t("bots.overview.noSessions")}</p>
  );
  const showTopEmpty = activeSessionIds.length === 0 && workingSessionIds.length === 0;
  const hasTopBlock = activeSessionIds.length > 0 || showTopEmpty;

  return (
    <div className="flex flex-col p-2" data-testid="bot-overview">
      {header}
      {activeSessionIds.length > 0 ? (
        <ProgressiveSessionList
          ids={activeSessionIds}
          maxHeight={ACTIVE_LIST_MAX_HEIGHT}
          renderSession={(id) => renderSession(id, noop)}
          testId="bot-overview-sessions"
        />
      ) : showTopEmpty ? (
        empty
      ) : null}
      <div
        className={
          hasTopBlock ? "mt-1.5 flex flex-col border-t border-border/50 pt-1.5" : "flex flex-col"
        }
      >
        {workingSessionIds.length > 0
          ? renderDropdownRow({
              kind: "working",
              label: t("bots.overview.working"),
              open: workingOpen,
              onOpenChange: setWorkingOpen,
              runningCount,
              runningLabel: t("bots.overview.running"),
              content: (
                <ProgressiveSessionList
                  ids={workingSessionIds}
                  maxHeight={SECTION_LIST_MAX_HEIGHT}
                  renderSession={(id) => renderSession(id, noop)}
                  testId="bot-overview-working-sessions"
                />
              ),
            })
          : null}
        {renderDropdownRow({
          kind: "settled",
          label: t("bots.overview.settled"),
          open: settledOpen,
          onOpenChange: setSettledOpen,
          runningCount: 0,
          runningLabel: t("bots.overview.running"),
          content:
            settledSessionIds.length === 0 ? (
              empty
            ) : (
              <ProgressiveSessionList
                ids={settledSessionIds}
                maxHeight={SECTION_LIST_MAX_HEIGHT}
                renderSession={(id) => renderSession(id, noop)}
                testId="bot-overview-settled-sessions"
              />
            ),
        })}
      </div>
    </div>
  );
}

function ProgressiveSessionList({
  ids,
  maxHeight,
  renderSession,
  testId,
}: {
  readonly ids: ReadonlyArray<string>;
  readonly maxHeight: string;
  readonly renderSession: (threadId: string) => ReactNode;
  readonly testId: string;
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const listRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const shownCount = Math.min(ids.length, visibleCount);
  const hasMore = shownCount < ids.length;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the bottom sentinel with IntersectionObserver to append the next page while scrolled
  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === "undefined") return;
    const list = listRef.current;
    const sentinel = sentinelRef.current;
    if (!list || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(ids.length, count + PAGE_COUNT));
        }
      },
      { root: list, rootMargin: "16px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, ids.length]);

  return (
    <ul
      ref={listRef}
      className="flex flex-col gap-0.5 overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maxHeight, overflowY: "auto", scrollbarWidth: "none" }}
      data-testid={testId}
    >
      {ids.slice(0, shownCount).map(renderSession)}
      {hasMore ? <li ref={sentinelRef} aria-hidden className="h-px shrink-0 list-none" /> : null}
    </ul>
  );
}
