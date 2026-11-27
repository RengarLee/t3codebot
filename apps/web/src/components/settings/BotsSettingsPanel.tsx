import { configureBotHttpAuthorization } from "@t3tools/bot/web/apiClient";
import { BotsSettingsView } from "@t3tools/bot/web/BotsSettingsView";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { updateBotClientPreferences, useBotClientPreferences } from "@t3tools/bot/web/preferences";
import { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { readLocalApi } from "../../localApi";
import {
  useEnvironmentHttpBaseUrl,
  usePrimaryEnvironment,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { BotAddFolderDialog } from "../bots/BotAddFolderDialog";
import { readBotHttpAuthorization } from "../bots/botHttpAuthorization";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow } from "./settingsLayout";

// Both bot entry points load with the app, so the first bot request already carries a credential.
configureBotHttpAuthorization(readBotHttpAuthorization);

export function BotsSettingsPanel() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const t = createBotTranslator(locale);
  const enabled = useBotClientPreferences((preferences) => preferences.botsBarEnabled);
  const environmentId = usePrimaryEnvironmentId();
  const primaryEnvironment = usePrimaryEnvironment();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const navigate = useNavigate();

  const canPickLocalFolder =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    primaryEnvironment !== null &&
    (primaryEnvironment.entry.target._tag === "PrimaryConnectionTarget" ||
      isDesktopLocalConnectionTarget(primaryEnvironment.entry.target));
  const pickFolder = canPickLocalFolder
    ? async () => (await readLocalApi()?.dialogs.pickFolder()) ?? null
    : undefined;

  const openThread = (threadId: string) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: ThreadId.make(threadId) },
    });
  };

  const title = t("bots.settings.showBar.title");
  return (
    <SettingsPageContainer className="gap-6">
      <BotsSettingsView
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        onOpenThread={openThread}
        sidebarToggleSlot={
          <SettingsRow
            id="bots-bar"
            title={title}
            devicePreference
            description={t("bots.settings.showBar.description")}
            control={
              <Switch
                checked={enabled}
                onCheckedChange={(checked) =>
                  updateBotClientPreferences({ botsBarEnabled: checked })
                }
                aria-label={title}
              />
            }
          />
        }
        renderAddFolderDialog={(dialogProps) => (
          <BotAddFolderDialog
            {...dialogProps}
            locale={locale}
            environmentId={environmentId}
            onPickFolder={pickFolder}
          />
        )}
      />
    </SettingsPageContainer>
  );
}
