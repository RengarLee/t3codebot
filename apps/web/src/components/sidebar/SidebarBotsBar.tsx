import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { SidebarBotsList } from "@t3tools/bot/web/SidebarBotsSection";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../../state/environments";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

export function SidebarBotsBar() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const t = createBotTranslator(locale);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
  const expanded = useBotClientPreferences((preferences) => preferences.sidebarBotsPanelOpen);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(usePrimaryEnvironmentId());
  if (!enabled) return null;
  return (
    <div className="mx-0.5" data-testid="sidebar-bots-bar">
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => updateBotClientPreferences({ sidebarBotsPanelOpen: !expanded })}
      >
        {t("bots.title")}
      </CollapsibleSectionHeader>
      {expanded && <SidebarBotsList locale={locale} httpBaseUrl={httpBaseUrl} />}
    </div>
  );
}
