import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_BOT_CLIENT_PREFERENCES } from "../contracts.ts";
import {
  getBotClientPreferences,
  resetBotClientPreferences,
  subscribeBotClientPreferences,
  updateBotClientPreferences,
} from "./preferences.ts";

describe("bot web preferences store", () => {
  it("persists patches independently from upstream ClientSettings and notifies subscribers", () => {
    resetBotClientPreferences();
    expect(getBotClientPreferences()).toEqual(DEFAULT_BOT_CLIENT_PREFERENCES);

    let notifications = 0;
    const unsubscribe = subscribeBotClientPreferences(() => {
      notifications += 1;
    });
    try {
      const updated = updateBotClientPreferences({
        botsBarEnabled: false,
        sidebarBotsPanelOpen: true,
      });
      expect(updated).toEqual({
        botsBarEnabled: false,
        sidebarBotsPanelOpen: true,
      });
      expect(getBotClientPreferences()).toEqual(updated);
      expect(notifications).toBe(1);

      resetBotClientPreferences();
      expect(getBotClientPreferences()).toEqual(DEFAULT_BOT_CLIENT_PREFERENCES);
      expect(notifications).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
