import { useBotList } from "@t3tools/bot/web/botList";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  sideThreadOpenIntentOf,
  type SideThreadOpenIntent,
} from "@t3tools/client-runtime/side-thread";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import * as Option from "effect/Option";
import type { MouseEvent } from "react";

import { useSideThreadTrigger } from "../../hooks/useSideThreadTrigger";
import { openSideThread } from "../../lib/sideChatPane";
import { isMacPlatform } from "../../lib/utils";
import { usePreparedConnection } from "../../state/session";
import { resolveThreadRouteTarget } from "../../threadRoutes";

const BOT_SESSION_CHIP_CLASS_NAME =
  "rounded-md border border-dashed border-border/80 bg-muted/35 px-1.5 py-0.5 text-[0.875em] font-normal text-muted-foreground [--context-chip-ink:var(--muted-foreground)] transition-colors hover:border-foreground/40 hover:text-foreground hover:[--context-chip-ink:var(--foreground)]";

export function isBotSessionThread(
  bots: ReadonlyArray<{
    readonly projectId: string | null;
    readonly homeThreadId: string | null;
  }>,
  projectId: string | null | undefined,
  threadId: string,
): boolean {
  if (!projectId) return false;
  return bots.some((bot) => bot.projectId === projectId && bot.homeThreadId !== threadId);
}

/**
 * Gives Bot session links a dashed-pill presentation and opens them in Home's right panel on a
 * plain click (Ctrl/Cmd + click or middle-click opens them in the main view).
 */
export function useBotSessionChip(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null | undefined;
}) {
  const prepared = usePreparedConnection(input.environmentId);
  const bots = useBotList(Option.isSome(prepared) ? prepared.value.httpBaseUrl : null);
  const navigate = useNavigate();
  const trigger = useSideThreadTrigger();
  const routeTarget = resolveThreadRouteTarget(useParams({ strict: false }));
  if (!isBotSessionThread(bots, input.projectId, input.threadId)) return null;

  const panelRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const threadRef = scopeThreadRef(input.environmentId, input.threadId);
  const open = (intent: SideThreadOpenIntent) => {
    openSideThread({
      threadRef,
      panelRef,
      intent,
      navigate: (ref) =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: ref.environmentId, threadId: ref.threadId },
        }),
    });
  };
  const { onClick: _triggerClick, ...auxTriggerProps } = trigger(open, {
    panel: panelRef !== null && panelRef.environmentId === input.environmentId,
  });

  return {
    className: BOT_SESSION_CHIP_CLASS_NAME,
    auxLinkProps: auxTriggerProps,
    onClick: (event: MouseEvent): boolean => {
      if (event.button !== 0 || event.shiftKey || event.altKey) return false;
      event.preventDefault();
      open(sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)));
      return true;
    },
  };
}
