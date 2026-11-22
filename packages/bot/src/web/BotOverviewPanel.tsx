import { useEffect, useRef, useState, type ReactNode } from "react";

import { createBotTranslator } from "./i18n.ts";

const INITIAL_COUNT = 10;
const PAGE_COUNT = 25;
// Shows 5 session rows (5 * 36px + 4 * 2px = 188px) by default inside each dropdown popup.
const DROPDOWN_LIST_MAX_HEIGHT = "11.75rem";

export interface BotOverviewDropdownRow {
  readonly kind: "active" | "settled";
  readonly label: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Shown on the Active row after Running when > 0. */
  readonly doneCount: number;
  readonly doneLabel: string;
  /** Shown on the Active row before Done when > 0. */
  readonly runningCount: number;
  readonly runningLabel: string;
  /** Shown on the Settled row; omitted on Active. */
  readonly totalCount: number | null;
  readonly content: ReactNode;
}

export interface BotOverviewPanelProps {
  readonly locale: string | undefined;
  /** Unsettled sessions, in the host's sidebar order. Home is left out. */
  readonly activeSessionIds: ReadonlyArray<string>;
  readonly settledSessionIds: ReadonlyArray<string>;
  readonly doneCount: number;
  readonly runningCount: number;
  /** Host thread row for one session, as an `<li>`. */
  readonly renderSession: (threadId: string, onSelect: () => void) => ReactNode;
  /** Host trigger + floating dropdown popup, matching ThreadDetailsPanel pickers. */
  readonly renderDropdownRow: (row: BotOverviewDropdownRow) => ReactNode;
}

export function BotOverviewPanel({
  locale,
  activeSessionIds,
  settledSessionIds,
  doneCount,
  runningCount,
  renderSession,
  renderDropdownRow,
}: BotOverviewPanelProps) {
  const t = createBotTranslator(locale);
  const [openSection, setOpenSection] = useState<"active" | "settled" | null>(null);
  const close = () => setOpenSection(null);
  const empty = (
    <p className="px-2.5 py-2 text-muted-foreground text-xs">{t("bots.overview.noSessions")}</p>
  );

  return (
    <div className="flex flex-col p-2" data-testid="bot-overview">
      {renderDropdownRow({
        kind: "active",
        label: t("bots.overview.active"),
        open: openSection === "active",
        onOpenChange: (open) =>
          setOpenSection(open ? "active" : openSection === "active" ? null : openSection),
        doneCount,
        doneLabel: t("bots.overview.done"),
        runningCount,
        runningLabel: t("bots.overview.running"),
        totalCount: null,
        content:
          activeSessionIds.length === 0 ? (
            empty
          ) : (
            <ProgressiveSessionList
              ids={activeSessionIds}
              renderSession={(id) => renderSession(id, close)}
              testId="bot-overview-sessions"
            />
          ),
      })}
      {renderDropdownRow({
        kind: "settled",
        label: t("bots.overview.settled"),
        open: openSection === "settled",
        onOpenChange: (open) =>
          setOpenSection(open ? "settled" : openSection === "settled" ? null : openSection),
        doneCount: 0,
        doneLabel: t("bots.overview.done"),
        runningCount: 0,
        runningLabel: t("bots.overview.running"),
        totalCount: settledSessionIds.length,
        content:
          settledSessionIds.length === 0 ? (
            empty
          ) : (
            <ProgressiveSessionList
              ids={settledSessionIds}
              renderSession={(id) => renderSession(id, close)}
              testId="bot-overview-settled-sessions"
            />
          ),
      })}
    </div>
  );
}

function ProgressiveSessionList({
  ids,
  renderSession,
  testId,
}: {
  readonly ids: ReadonlyArray<string>;
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
      style={{ maxHeight: DROPDOWN_LIST_MAX_HEIGHT, overflowY: "auto", scrollbarWidth: "none" }}
      data-testid={testId}
    >
      {ids.slice(0, shownCount).map(renderSession)}
      {hasMore ? <li ref={sentinelRef} aria-hidden className="h-px shrink-0 list-none" /> : null}
    </ul>
  );
}
