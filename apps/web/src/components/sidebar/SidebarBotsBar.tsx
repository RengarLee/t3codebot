import { useBotProjectIds } from "@t3tools/bot/web/botList";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { SidebarBotsSection } from "@t3tools/bot/web/SidebarBotsSection";
import type { BotSummary } from "@t3tools/bot/contracts";
import { ProjectId, ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { deriveProjectIdentity } from "../../projectIdentity";
import {
  useProject,
  useServerConfigs,
  useThreadShell,
  useThreadShells,
} from "../../state/entities";
import {
  useEnvironmentHttpBaseUrl,
  useEnvironmentIdentities,
  useEnvironmentMachines,
  useEnvironmentProviders,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import {
  deriveProviderEntriesByEnvironment,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectMonogram } from "../ProjectMonogram";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

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
      {/* Same hover timing as the thread list's provider in Sidebar. */}
      <TooltipProvider delay={150} closeDelay={0} timeout={400}>
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
          renderBotRow={(row, bot) => (
            <Tooltip>
              <TooltipTrigger render={row} />
              <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
                {environmentId === null ? null : (
                  <BotHoverCard bot={bot} environmentId={environmentId} />
                )}
              </ThreadHoverCardPopup>
            </Tooltip>
          )}
        />
      </TooltipProvider>
    </div>
  );
}

/** The thread hover card's rows for a bot, read from its project and its sessions there. */
function BotHoverCard({
  bot,
  environmentId,
}: {
  readonly bot: BotSummary;
  readonly environmentId: EnvironmentId;
}) {
  const project = useProject(
    bot.projectId === null ? null : { environmentId, projectId: ProjectId.make(bot.projectId) },
  );
  const session = useThreadShells().find(
    (thread) => thread.environmentId === environmentId && thread.projectId === bot.projectId,
  );
  const environmentLabel =
    useEnvironmentIdentities().find((environment) => environment.environmentId === environmentId)
      ?.label ?? null;
  const machine = useEnvironmentMachines().get(environmentId) ?? "server";
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const config = useServerConfigs().get(environmentId);
  const providerEntries: ReadonlyMap<string, ProviderInstanceEntry> =
    deriveProviderEntriesByEnvironment(
      config === undefined ? [] : [[environmentId, providers, config.settings]],
    ).get(environmentId) ?? new Map();
  const modelSelection = session?.modelSelection ?? project?.defaultModelSelection ?? null;
  const instanceId = session?.runtime?.providerInstanceId ?? modelSelection?.instanceId;
  const providerEntry = instanceId === undefined ? undefined : providerEntries.get(instanceId);
  const showInstanceBadge =
    providerEntry !== undefined && shouldShowInstanceBadge(providerEntry, providerEntries.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection?.model);
  const modelLabel = selectedModel
    ? getTriggerDisplayModelName(selectedModel, providerEntry?.driverKind)
    : modelSelection?.model;
  // Rows mirror SidebarThreadTooltip; copied so the upstream file stays untouched.
  return (
    <ThreadHoverCard title={bot.name}>
      {project ? (
        <div className="flex min-w-0 items-center gap-2">
          <ProjectFavicon project={project} className="size-3 shrink-0" />
          <div className="min-w-0 truncate text-foreground/75">{project.title}</div>
        </div>
      ) : null}
      {environmentLabel ? (
        <div className="flex min-w-0 items-center gap-2">
          <EnvironmentMachineIcon
            kind={machine}
            className="size-3 shrink-0 stroke-muted-foreground"
          />
          <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
        </div>
      ) : null}
      {providerEntry ? (
        <div className="flex min-w-0 items-center gap-2">
          <ProviderInstanceIcon
            driverKind={providerEntry.driverKind}
            displayName={providerEntry.displayName}
            accentColor={providerEntry.accentColor}
            acpRegistryAgentId={providerEntry.acpRegistryAgentId}
            acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
            showBadge={showInstanceBadge && providerEntry.accentColor !== undefined}
            badgeContent="none"
            badgeClassName="h-2 min-w-2 px-0"
            iconClassName="size-3 shrink-0 opacity-60"
          />
          <div className="min-w-0 truncate text-foreground/75">
            {showInstanceBadge ? `${modelLabel} · ${providerEntry.displayName}` : modelLabel}
          </div>
        </div>
      ) : null}
    </ThreadHoverCard>
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
