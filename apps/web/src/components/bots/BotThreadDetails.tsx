import { BotOverviewPanel, type BotOverviewDropdownRow } from "@t3tools/bot/web/BotOverviewPanel";
import { useBotList } from "@t3tools/bot/web/botList";
import { MAIN_BOT_ID, type BotSummary } from "@t3tools/bot/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SideThreadOpenIntent } from "@t3tools/client-runtime/side-thread";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  resolveSettledThreadTimestamp,
  resolveThreadActivityTimestamp,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/client-runtime/thread-pull-requests";
import {
  ProjectId,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  Undo2Icon,
  UserRoundIcon,
} from "lucide-react";
import {
  useLayoutEffect,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useSideThreadTrigger } from "../../hooks/useSideThreadTrigger";
import { useSupportsMultiplePullRequests } from "../../hooks/useSupportsMultiplePullRequests";
import { useThreadActions } from "../../hooks/useThreadActions";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { openSideThread } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { requestWorkspaceFocus, workspaceAreaProps } from "../../lib/workspaceFocus";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { formatRelativeTime } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { useChatCanvas } from "../chat/ChatCanvasContext";
import type { ThreadDetailsCard } from "../chat/ThreadDetailsCard";
import { THREAD_DETAILS_CARD_GAP } from "../chat/threadDetailsCardLayout";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CLASS,
} from "../chat/threadDetailsPanelStyles";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  shouldRecedeSidebarThread,
  sortThreadsForSidebar,
} from "../Sidebar.logic";
import {
  ThreadPullRequestBadgeControl,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  useLinkedThreadPullRequest,
} from "../ThreadStatusIndicators";
import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type HostDetailsProps = Pick<ComponentProps<typeof ThreadDetailsCard>, "anchor" | "handle"> & {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
};

/** Shows the bot overview only on the main bot's Home thread; sessions show normal thread details. */
export function withBotThreadDetails<P extends HostDetailsProps>(Host: ComponentType<P>) {
  return function BotAwareThreadDetails(props: P) {
    const bots = useBotList(useEnvironmentHttpBaseUrl(props.environmentId));
    const mainBot = bots.find((candidate) => candidate.id === MAIN_BOT_ID);
    const isMainBotHome =
      mainBot !== undefined &&
      mainBot.projectId === props.projectId &&
      mainBot.homeThreadId === props.threadId;
    return isMainBotHome ? (
      <BotThreadDetails {...props} bot={mainBot} bots={bots} />
    ) : (
      <Host {...props} />
    );
  };
}

export function countBotActiveSessionStatuses(
  activeSessions: ReadonlyArray<EnvironmentThreadShell>,
  threadLastVisitedAtById: Readonly<Record<string, string | undefined>>,
): { readonly attentionCount: number; readonly runningCount: number; readonly doneCount: number } {
  let attentionCount = 0;
  let runningCount = 0;
  let doneCount = 0;
  for (const thread of activeSessions) {
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      threadLastVisitedAtById[scopedThreadKey(threadRef)],
    );
    const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
    if (status === "approval" || status === "input" || status === "request") {
      attentionCount += 1;
    } else if (status === "preparing" || status === "working" || status === "waiting") {
      runningCount += 1;
    } else if (status === "ready" && hasUnseenCompletion({ ...thread, lastVisitedAt })) {
      doneCount += 1;
    }
  }
  return { attentionCount, runningCount, doneCount };
}

export function BotSessionStatusPills({
  attentionCount,
  attentionLabel,
  runningCount,
  runningLabel,
  doneCount,
  doneLabel,
  testIdPrefix = "bot-overview",
}: {
  readonly attentionCount: number;
  readonly attentionLabel: string;
  readonly runningCount: number;
  readonly runningLabel: string;
  readonly doneCount: number;
  readonly doneLabel: string;
  readonly testIdPrefix?: string;
}) {
  if (attentionCount === 0 && runningCount === 0 && doneCount === 0) return null;
  return (
    <>
      {attentionCount > 0 ? (
        <span
          aria-label={`${attentionLabel} ${attentionCount}`}
          data-testid={`${testIdPrefix}-attention-count`}
          className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium leading-none text-warning-foreground"
        >
          <MessageCircleQuestionIcon aria-hidden className="size-3 shrink-0" />
          {attentionCount}
        </span>
      ) : null}
      {runningCount > 0 ? (
        <span
          aria-label={`${runningLabel} ${runningCount}`}
          data-testid={`${testIdPrefix}-running-count`}
          className="inline-flex items-center gap-1 rounded-full bg-info/15 px-1.5 py-0.5 text-2xs font-medium leading-none text-info-foreground"
        >
          <CircleDashedIcon aria-hidden className="size-3 shrink-0" />
          {runningCount}
        </span>
      ) : null}
      {doneCount > 0 ? (
        <span
          aria-label={`${doneLabel} ${doneCount}`}
          data-testid={`${testIdPrefix}-done-count`}
          className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-2xs font-medium leading-none text-success-foreground"
        >
          <CircleCheckIcon aria-hidden className="size-3 shrink-0" />
          {doneCount}
        </span>
      ) : null}
    </>
  );
}

function isWorkingBotSession(
  thread: EnvironmentThreadShell,
  threadLastVisitedAtById: Readonly<Record<string, string | undefined>>,
): boolean {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  return status === "preparing" || status === "working" || status === "waiting";
}

function BotThreadDetails({
  anchor,
  handle,
  environmentId,
  threadId,
  bot,
  bots,
}: HostDetailsProps & {
  readonly bot: BotSummary;
  readonly bots: ReadonlyArray<BotSummary>;
}) {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const navigate = useNavigate();
  const { settleThread, unsettleThread } = useThreadActions();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const projectRefs = bots.flatMap((candidate) =>
    candidate.projectId === null
      ? []
      : [{ environmentId, projectId: ProjectId.make(candidate.projectId) }],
  );
  const sessions = useThreadShellsForProjectRefs(projectRefs).filter(
    (thread) => thread.archivedAt === null && thread.id !== bot.homeThreadId,
  );
  const sessionsById = new Map(sessions.map((thread) => [thread.id as string, thread]));
  const isSettled = (thread: EnvironmentThreadShell) => thread.settledOverride === "settled";
  const unsettled = sessions.filter((thread) => !isSettled(thread));
  const working = sortThreadsForSidebar(
    unsettled.filter((thread) => isWorkingBotSession(thread, threadLastVisitedAtById)),
  );
  const active = sortThreadsForSidebar(
    unsettled.filter((thread) => !isWorkingBotSession(thread, threadLastVisitedAtById)),
  );
  const settled = sortSettledThreads(sessions.filter(isSettled));
  const panelRef = scopeThreadRef(environmentId, threadId);
  const openSession = (id: ThreadId, intent: SideThreadOpenIntent) => {
    openSideThread({
      threadRef: scopeThreadRef(environmentId, id),
      panelRef,
      intent,
      navigate: (ref) =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: ref.environmentId, threadId: ref.threadId },
        }),
    });
  };
  return (
    <BotDetailsCard threadRef={{ environmentId, threadId }} anchor={anchor} handle={handle}>
      <BotOverviewPanel
        key={bot.id}
        locale={locale}
        activeSessionIds={active.map((thread) => thread.id)}
        workingSessionIds={working.map((thread) => thread.id)}
        settledSessionIds={settled.map((thread) => thread.id)}
        runningCount={working.length}
        renderSession={(id, onSelect) => {
          const thread = sessionsById.get(id);
          return thread === undefined ? null : (
            <BotSessionRow
              key={id}
              thread={thread}
              settled={isSettled(thread)}
              current={thread.id === threadId}
              onOpen={(targetId, intent) => {
                onSelect();
                openSession(targetId, intent);
              }}
              onToggleSettle={(targetRef, currentlySettled) => {
                void (currentlySettled ? unsettleThread(targetRef) : settleThread(targetRef));
              }}
            />
          );
        }}
        renderDropdownRow={(row) => <BotSessionDropdownRow key={row.kind} row={row} />}
      />
    </BotDetailsCard>
  );
}

function BotSessionDropdownRow({ row }: { readonly row: BotOverviewDropdownRow }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={row.open}
        data-testid={`bot-overview-${row.kind}-trigger`}
        onClick={() => row.onOpenChange(!row.open)}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          THREAD_DETAILS_PANEL_ROW_CLASS,
          row.open && "bg-black/[0.035] dark:bg-white/[0.08]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <BotSessionStatusPills
            attentionCount={0}
            attentionLabel=""
            runningCount={row.runningCount}
            runningLabel={row.runningLabel}
            doneCount={0}
            doneLabel=""
          />
          <ChevronDownIcon
            aria-hidden
            className={cn(
              THREAD_DETAILS_PANEL_CHEVRON_CLASS,
              "transition-transform",
              row.open && "rotate-180",
            )}
          />
        </span>
      </button>
      {row.open ? (
        <div className="pt-1 pb-1.5" data-testid={`bot-overview-${row.kind}-popup`}>
          {row.content}
        </div>
      ) : null}
    </div>
  );
}

// Mirrors ThreadDetailsCard's shell and popover fallback, but floats over the chat canvas
// without reserving horizontal lane space so toggling it never shifts the messages or composer.
function BotDetailsCard({
  threadRef,
  anchor,
  handle,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly anchor: ComponentProps<typeof ThreadDetailsCard>["anchor"];
  readonly handle: ComponentProps<typeof ThreadDetailsCard>["handle"];
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const detailsArea = workspaceAreaProps("details", 3, gt("Thread details"));
  const canvas = useChatCanvas();
  const placement = canvas?.detailsCardPlacement ?? null;
  const mode = placement ? "inline" : "popover";
  const topInset = canvas?.detailsCardTopInset ?? 0;
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  const height = placement?.height ?? Math.max(0, (canvas?.container.height ?? 0) - 52);
  const measureDetailsCard = canvas?.measureDetailsCard;
  const { environmentId, threadId } = threadRef;

  // Clear any obstacle left if the host card briefly mounted while bots were still loading.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears canvas obstacle measurement so the bot details card floats over the chat lane
  useLayoutEffect(() => {
    measureDetailsCard?.({
      threadRef: { environmentId, threadId },
      width: 0,
      fullContentHeight: 0,
    });
  }, [measureDetailsCard, environmentId, threadId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the popover flag in the right panel store when the derived mode turns inline
  useLayoutEffect(() => {
    if (mode === "inline" && popoverOpen) {
      useRightPanelStore
        .getState()
        .setThreadPanelOpen({ environmentId, threadId }, "popover", false);
    }
  }, [mode, popoverOpen, environmentId, threadId]);

  const card = (
    <div
      className={cn(
        "dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl",
        mode === "popover" &&
          "max-h-[min(calc(100dvh-6.5rem),calc(var(--available-height,100dvh)-1rem))]",
      )}
      style={placement ? { maxHeight: height } : undefined}
      data-thread-details-card
    >
      <ScrollArea scrollFade className="min-h-0">
        {children}
      </ScrollArea>
    </div>
  );

  return (
    <Popover
      handle={handle}
      open={mode === "popover" && popoverOpen}
      onOpenChange={(open, details) => {
        const target =
          details.reason === "focus-out"
            ? (details.event as FocusEvent).relatedTarget
            : details.reason === "outside-press"
              ? details.event.target
              : null;
        if (!open && target instanceof Element && target.closest("[data-thread-find-bar]")) {
          details.cancel();
          return;
        }
        useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", open);
      }}
    >
      {placement && inlineOpen ? (
        <aside
          {...detailsArea}
          data-workspace-focus-key={`details:${environmentId}:${threadId}`}
          className={cn(
            "absolute z-20",
            topInset > 0 && "transition-[top] duration-150 ease-out motion-reduce:transition-none",
          )}
          style={{
            right: placement.right,
            top: placement.y,
            width: placement.width,
            maxHeight: height,
          }}
          data-density="full"
          data-thread-details-panel="inline"
        >
          {card}
        </aside>
      ) : null}
      {/* Rendered in both modes so Base UI's exit animation finishes cleanly when switching inline. */}
      <PopoverPopup
        {...(mode === "popover" ? detailsArea : {})}
        role="dialog"
        data-workspace-focus-key={`details:${environmentId}:${threadId}`}
        initialFocus={() => {
          requestWorkspaceFocus({ area: "details" });
          return false;
        }}
        anchor={anchor}
        align="end"
        alignOffset={THREAD_DETAILS_CARD_GAP - 8}
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        side="bottom"
        sideOffset={topInset}
        variant="panel"
        padding="none"
      >
        {mode === "popover" ? (
          <div data-density="full" data-thread-details-panel="popover">
            {card}
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

const STATUS_ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  done: CircleCheckIcon,
} as const;

// Status, PR badge and time mirror SidebarThreadRow's folder rows; copied so the upstream row stays untouched.
function BotSessionRow({
  thread,
  settled,
  current,
  onOpen,
  onToggleSettle,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly settled: boolean;
  readonly current: boolean;
  readonly onOpen: (threadId: ThreadId, intent: SideThreadOpenIntent) => void;
  readonly onToggleSettle: (threadRef: ScopedThreadRef, settled: boolean) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const trigger = useSideThreadTrigger();
  const triggerProps = trigger((intent) => onOpen(thread.id, intent), { panel: true });
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const localLastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const recede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke: false,
    isActive: current,
    isSelected: false,
  });
  const topStatus =
    status === "preparing" || status === "working"
      ? {
          label:
            status === "preparing"
              ? gt("Setting up")
              : thread.goal?.status === "active"
                ? gt("Goal", { $context: "thread status: working on a goal" })
                : gt("Working", { $context: "thread status" }),
          icon: "working" as const,
          className: "text-info-foreground",
        }
      : status === "waiting"
        ? {
            label: gt("Waiting", { $context: "thread status" }),
            icon: "waiting" as const,
            className: "text-muted-foreground",
          }
        : status === "approval"
          ? {
              label: gt("Approval", { $context: "thread status: needs approval" }),
              icon: "approval" as const,
              className: "text-warning-foreground",
            }
          : status === "input"
            ? {
                label: gt("Input", { $context: "thread status: needs user input" }),
                icon: "input" as const,
                className: "text-indigo-600 dark:text-indigo-300",
              }
            : status === "request"
              ? {
                  label: gt("Request", { $context: "thread status: guest request" }),
                  icon: "request" as const,
                  className: "text-guest-foreground",
                }
              : status === "limited"
                ? {
                    label: gt("Limited", { $context: "thread status: usage limited" }),
                    icon: "failed" as const,
                    className: "text-warning-foreground",
                  }
                : status === "failed"
                  ? {
                      label: gt("Failed", { $context: "thread status" }),
                      icon: "failed" as const,
                      className: "text-error-foreground",
                    }
                  : isUnread
                    ? {
                        label: gt("Done", { $context: "thread status" }),
                        icon: "done" as const,
                        className: "text-success-foreground",
                      }
                    : null;
  const StatusIcon = topStatus === null ? null : STATUS_ICONS[topStatus.icon];

  const openPrLink = useOpenPrLink();
  const linkedPullRequest = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    true,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const pr = linkedPullRequest?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;
  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={prBadgeShape}
        pullRequests={thread.pullRequests}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatusIndicator(pr, linkedPullRequest?.sourceControlProvider, messages)}
        onOpenList={() => {
          useRightPanelStore.getState().open(threadRef, "pull-requests");
          if (!current) onOpen(thread.id, "main");
        }}
        onOpenPullRequest={(event, targetUrl) => {
          const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
          if (url) openPrLink(event, url);
        }}
      />
    ) : null;

  return (
    <li className="list-none">
      <div
        role="button"
        tabIndex={0}
        aria-current={current ? "page" : undefined}
        {...triggerProps}
        onKeyDown={(event) => {
          triggerProps.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen(thread.id, "primary");
        }}
        className={cn(
          "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          current
            ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
            : recede || settled
              ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-start text-sm",
            recede || settled ? "font-normal" : "font-medium",
            recede || settled
              ? "text-foreground/75 group-hover/sidebar-row:text-foreground"
              : "text-foreground",
          )}
        >
          {thread.title}
        </span>
        {prBadge}
        <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end tabular-nums text-secondary-label">
          <span
            className={cn(
              "inline-flex items-center",
              (settled ||
                (status !== "preparing" && status !== "working" && status !== "waiting")) &&
                "transition-opacity group-any-hover/sidebar-row:opacity-0 group-focus-within/sidebar-row:opacity-0",
            )}
          >
            {topStatus !== null && StatusIcon !== null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  topStatus.className,
                )}
              >
                <StatusIcon aria-hidden className="size-3 shrink-0" />
                {topStatus.label}
              </span>
            ) : (
              <span className="text-xs">
                <RelativeTimeLabel
                  timestamp={
                    settled
                      ? resolveSettledThreadTimestamp(thread)
                      : resolveThreadActivityTimestamp(thread)
                  }
                />
              </span>
            )}
          </span>
          {settled || (status !== "preparing" && status !== "working" && status !== "waiting") ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={settled ? gt("Un-settle thread") : gt("Settle thread")}
                    data-testid={settled ? "bot-session-unsettle" : "bot-session-settle"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSettle(threadRef, settled);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="pointer-events-none absolute inset-y-0 right-0 -mr-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100"
                  />
                }
              >
                {settled ? (
                  <Undo2Icon className="mb-px size-3.5" />
                ) : (
                  <CheckIcon className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {settled ? <T>Un-settle thread</T> : <T>Settle thread</T>}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      </div>
    </li>
  );
}

function RelativeTimeLabel({ timestamp }: { readonly timestamp: string | null }) {
  const nowMinute = useNowMinute();
  const resolve = useMessages();
  if (timestamp === null) return null;
  const parts = formatRelativeTime(timestamp, Date.parse(`${nowMinute}:00.000Z`), resolve);
  if (parts === null) return null;
  return parts.suffix === null ? resolve(msg("now", { $context: "relative time" })) : parts.value;
}
