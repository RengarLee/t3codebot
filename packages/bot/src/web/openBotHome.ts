import { useState } from "react";

import { ensureBotHome, notifyBotsServerStateChanged } from "./apiClient.ts";

/** Opens a bot's Home thread, launching it on the server when it has none yet. */
export function useOpenBotHome(
  httpBaseUrl: string | null | undefined,
  onOpenThread: (threadId: string) => void,
) {
  const [openingBotId, setOpeningBotId] = useState<string | null>(null);
  const [failedBotId, setFailedBotId] = useState<string | null>(null);

  const openHome = async (botId: string, knownProjectId: string | null) => {
    if (openingBotId !== null) return;
    setOpeningBotId(botId);
    setFailedBotId(null);
    try {
      const { home } = await ensureBotHome(botId, { httpBaseUrl });
      if (home.homeThreadId === null) throw new Error("Home thread missing");
      // The sidebar hides bot sessions by project, so it must learn a newly created one.
      if (home.projectId !== knownProjectId) notifyBotsServerStateChanged();
      onOpenThread(home.homeThreadId);
    } catch {
      setFailedBotId(botId);
    } finally {
      setOpeningBotId(null);
    }
  };

  return { openHome, openingBotId, failedBotId };
}
