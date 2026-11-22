import { useBotProjectIds } from "@t3tools/bot/web/botList";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { SidebarBotsSection } from "@t3tools/bot/web/SidebarBotsSection";
import { ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { deriveProjectIdentity } from "../../projectIdentity";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../../state/environments";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { ProjectMonogram } from "../ProjectMonogram";

export function SidebarBotsBar() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
  const expanded = useBotClientPreferences((preferences) => preferences.sidebarBotsPanelOpen);
  const environmentId = usePrimaryEnvironmentId();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const navigate = useNavigate();
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  const routeThread = useThreadShell(target?.kind === "server" ? target.threadRef : null);
  if (!enabled) return null;
  const openThread = (threadId: string) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: ThreadId.make(threadId) },
    });
  };
  return (
    <div className="mx-0.5 mt-1" data-testid="sidebar-bots-bar">
      <SidebarBotsSection
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        expanded={expanded}
        onToggleExpanded={() => updateBotClientPreferences({ sidebarBotsPanelOpen: !expanded })}
        activeProjectId={
          routeThread !== null && routeThread.environmentId === environmentId
            ? routeThread.projectId
            : null
        }
        onOpenThread={openThread}
        renderBotIcon={(name) => {
          const identity = deriveProjectIdentity(name);
          return <ProjectMonogram text={identity.monogram} color={identity.color} />;
        }}
      />
    </div>
  );
}

/** Bot sessions are opened from the Bots section, so the thread list leaves them out. */
export function useThreadsWithoutBotSessions<
  T extends { readonly environmentId: string; readonly projectId: string },
>(threads: readonly T[]): readonly T[] {
  const environmentId = usePrimaryEnvironmentId();
  const botProjectIds = useBotProjectIds(useEnvironmentHttpBaseUrl(environmentId));
  if (botProjectIds.size === 0) return threads;
  return threads.filter(
    (thread) => thread.environmentId !== environmentId || !botProjectIds.has(thread.projectId),
  );
}
