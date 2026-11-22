import { useGT } from "gt-react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function BotsSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const enabled = useClientSettings((settings) => settings.botsBarEnabled);
  const setting = searchableSetting("bots-bar");
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Bots")}>
        <SettingsRow
          {...setting}
          devicePreference
          description={gt("Show the bar below the search field in the sidebar.")}
          control={
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void updateClientSettings({ botsBarEnabled: checked })}
              aria-label={setting.title}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
