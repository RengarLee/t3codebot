import { BotsListSection } from "@t3tools/bot/web/BotsSettingsView";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../../state/environments";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function BotsSettingsPanel() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const t = createBotTranslator(locale);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
  const environmentId = usePrimaryEnvironmentId();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const navigate = useNavigate();
  const openThread = (threadId: string) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: ThreadId.make(threadId) },
    });
  };
  const title = t("bots.settings.showBar.title");
  return (
    <SettingsPageContainer>
      <SettingsSection title={t("bots.title")}>
        <SettingsRow
          id="bots-bar"
          title={title}
          devicePreference
          description={t("bots.settings.showBar.description")}
          control={
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => updateBotClientPreferences({ botsBarEnabled: checked })}
              aria-label={title}
            />
          }
        />
        <SettingsRow id="bots-main" title={t("bots.main.title")}>
          <BotsListSection
            role="main"
            locale={locale}
            httpBaseUrl={httpBaseUrl}
            onOpenThread={openThread}
          />
        </SettingsRow>
        <SettingsRow id="bots-list" title={t("bots.list.title")}>
          <BotsListSection
            role="sub"
            locale={locale}
            httpBaseUrl={httpBaseUrl}
            onOpenThread={openThread}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
