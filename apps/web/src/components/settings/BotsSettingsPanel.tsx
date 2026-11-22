import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function BotsSettingsPanel() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const t = createBotTranslator(locale);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
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
      </SettingsSection>
    </SettingsPageContainer>
  );
}
