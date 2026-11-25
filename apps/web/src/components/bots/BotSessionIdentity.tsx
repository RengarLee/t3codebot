import { useBotList } from "@t3tools/bot/web/botList";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function BotSessionIdentity({
  environmentId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  const bots = useBotList(useEnvironmentHttpBaseUrl(environmentId));
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const bot = bots.find((candidate) => candidate.projectId === projectId);
  if (!bot || bot.homeThreadId === threadId) return null;
  const label = `${createBotTranslator(locale)("bots.title")}: ${bot.name}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="bot-session-identity"
            aria-label={label}
            className="inline-flex min-w-0 max-w-48 items-center gap-1 text-xs text-muted-foreground"
          />
        }
      >
        <BotIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{bot.name}</span>
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
