import { BotActivityPanel, type BotSessionControlProps } from "@t3tools/bot/web/BotSessionsPanel";
import { useBotList } from "@t3tools/bot/web/botList";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { MAIN_BOT_ID } from "@t3tools/bot/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { scopeThreadShell } from "@t3tools/client-runtime/state/models";
import {
  ProjectId,
  ThreadId,
  type EnvironmentId,
  type ScopedThreadRef,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ArrowRightIcon, MinusIcon, PlusIcon, MaximizeIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { cn } from "../../lib/utils";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Button } from "../ui/button";
import SideThreadPane from "../chat/SideThreadPane";
import "./styles.css";

export function BotDetailsSidebar({
  threadRef,
  parentPanel,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly parentPanel: SideChatParentPanel;
}) {
  const { mainBot, liveById, sessionProps } = useBotSessionView(threadRef.environmentId);
  if (!mainBot?.homeThreadId) return null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bot-details-sidebar">
      <BotActivityPanel
        key={threadRef.environmentId + ":" + mainBot.homeThreadId}
        {...sessionProps}
        homeThreadId={ThreadId.make(mainBot.homeThreadId)}
        resolveThread={(thread) => liveById.get(thread.id)?.source ?? thread}
        renderConversation={(thread, onClose) => (
          <SideThreadPane
            parentRef={threadRef}
            parentPanel={parentPanel}
            surface={{ id: `thread:${thread.id}`, kind: "thread", threadId: thread.id }}
            onClose={onClose}
          />
        )}
      />
    </div>
  );
}

function useBotSessionView(environmentId: EnvironmentId) {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const bots = useBotList(httpBaseUrl);
  const mainBot = bots.find((candidate) => candidate.id === MAIN_BOT_ID);
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const projectRefs = bots.flatMap((candidate) =>
    candidate.projectId === null
      ? []
      : [{ environmentId, projectId: ProjectId.make(candidate.projectId) }],
  );
  const live = useThreadShellsForProjectRefs(projectRefs);
  const liveById = new Map(live.map((thread) => [thread.id, thread]));
  const revision = live
    .map((thread) => `${thread.id}:${thread.title}`)
    .sort()
    .join("|");
  const t = createBotTranslator(locale);
  const renderStatus = (source: OrchestrationV2ThreadShell) => {
    const thread = liveById.get(source.id) ?? scopeThreadShell(environmentId, source);
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      visits[scopedThreadKey(scopeThreadRef(environmentId, thread.id))],
    );
    const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
    const color =
      status === "failed"
        ? "text-destructive"
        : status === "approval" ||
            status === "input" ||
            status === "limited" ||
            status === "request"
          ? "text-warning-foreground"
          : status === "working" || status === "preparing"
            ? "text-info-foreground"
            : "text-muted-foreground";
    return (
      <span className={cn("shrink-0 whitespace-nowrap text-xs", color)}>
        {t(`bots.sessions.status.${status}`)}
      </span>
    );
  };
  return {
    mainBot,
    liveById,
    sessionProps: {
      httpBaseUrl,
      locale,
      revision,
      botName: (thread: OrchestrationV2ThreadShell) =>
        bots.find((candidate) => candidate.projectId === thread.projectId)?.name ?? "",
      renderStatus,
      Control: BotSessionControl,
    },
  };
}

function BotSessionControl({ kind, label, onClick, disabled }: BotSessionControlProps) {
  const Icon =
    kind === "open"
      ? ArrowRightIcon
      : kind === "back"
        ? ArrowLeftIcon
        : kind === "in"
          ? PlusIcon
          : kind === "out"
            ? MinusIcon
            : kind === "fit"
              ? MaximizeIcon
              : null;
  return (
    <Button
      variant="ghost"
      size={kind === "more" || kind === "back" ? "compact" : "icon-sm"}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {Icon === null ? null : <Icon aria-hidden />}
      {kind === "more" || kind === "back" ? label : null}
    </Button>
  );
}
