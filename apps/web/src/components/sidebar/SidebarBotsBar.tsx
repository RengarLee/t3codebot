import { configureBotHttpAuthorization } from "@t3tools/bot/web/apiClient";
import {
  useBotList,
  useBotProjectIds,
  useReloadBotListOnNewProjects,
} from "@t3tools/bot/web/botList";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { SidebarMainBotEntry } from "@t3tools/bot/web/SidebarMainBotEntry";
import { MAIN_BOT_ID, type BotSummary } from "@t3tools/bot/contracts";
import { ProjectId, ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { readBotHttpAuthorization } from "../bots/botHttpAuthorization";
import {
  useProject,
  useServerConfigs,
  useThreadShell,
  useThreadShells,
  useThreadShellsForProjectRefs,
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
import { useUiStateStore } from "../../uiStateStore";
import { BotSessionStatusPills, countBotActiveSessionStatuses } from "../bots/BotThreadDetails";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

// Both bot entry points load with the app, so the first bot request already carries a credential.
configureBotHttpAuthorization(readBotHttpAuthorization);

export function SidebarBotsBar() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
  const environmentId = usePrimaryEnvironmentId();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const navigate = useNavigate();
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  const routeThread = useThreadShell(target?.kind === "server" ? target.threadRef : null);
  const bots = useBotList(httpBaseUrl);
  const mainBot = bots.find((candidate) => candidate.id === MAIN_BOT_ID);
  const botProjectIds = useBotProjectIds(httpBaseUrl);
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
        <SidebarMainBotEntry
          locale={locale}
          httpBaseUrl={httpBaseUrl}
          activeProjectId={
            routeThread !== null &&
            routeThread.environmentId === environmentId &&
            botProjectIds.has(routeThread.projectId)
              ? (mainBot?.projectId ?? routeThread.projectId)
              : null
          }
          onOpenThread={openThread}
          renderBotRow={(row, bot) => (
            <Tooltip>
              <TooltipTrigger render={row} />
              <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
                {environmentId === null ? null : (
                  <BotHoverCard
                    bot={bot}
                    title={createBotTranslator(locale)("bots.main.title")}
                    environmentId={environmentId}
                  />
                )}
              </ThreadHoverCardPopup>
            </Tooltip>
          )}
          renderBotTrailing={(bot) =>
            environmentId === null ? null : (
              <BotSidebarStatusPills
                bot={bot}
                bots={bots}
                environmentId={environmentId}
                locale={locale}
              />
            )
          }
        />
      </TooltipProvider>
    </div>
  );
}

function BotSidebarStatusPills({
  bot,
  bots,
  environmentId,
  locale,
}: {
  readonly bot: BotSummary;
  readonly bots: ReadonlyArray<BotSummary>;
  readonly environmentId: EnvironmentId;
  readonly locale: string | undefined;
}) {
  const t = createBotTranslator(locale);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const projectRefs = bots.flatMap((candidate) =>
    candidate.projectId === null
      ? []
      : [{ environmentId, projectId: ProjectId.make(candidate.projectId) }],
  );
  const activeSessions = useThreadShellsForProjectRefs(projectRefs).filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.id !== bot.homeThreadId &&
      thread.settledOverride !== "settled",
  );
  const { attentionCount, runningCount, doneCount } = countBotActiveSessionStatuses(
    activeSessions,
    threadLastVisitedAtById,
  );
  if (attentionCount === 0 && runningCount === 0 && doneCount === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 tabular-nums">
      <BotSessionStatusPills
        attentionCount={attentionCount}
        attentionLabel={t("bots.overview.needsAttention")}
        runningCount={runningCount}
        runningLabel={t("bots.overview.running")}
        doneCount={doneCount}
        doneLabel={t("bots.overview.done")}
        testIdPrefix="sidebar-main-bot"
      />
    </span>
  );
}

/** The thread hover card's rows for a bot, read from its project and its sessions there. */
function BotHoverCard({
  bot,
  title,
  environmentId,
}: {
  readonly bot: BotSummary;
  readonly title: string;
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
    <ThreadHoverCard title={title}>
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
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const botProjectIds = useBotProjectIds(httpBaseUrl);
  useReloadBotListOnNewProjects(
    httpBaseUrl,
    threads.map((thread) => thread.projectId),
  );
  if (botProjectIds.size === 0) return threads;
  return threads.filter(
    (thread) => thread.environmentId !== environmentId || !botProjectIds.has(thread.projectId),
  );
}
