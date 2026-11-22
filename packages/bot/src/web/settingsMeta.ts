export const BOT_SETTINGS_PATH = "/settings/bots" as const;

export const BOT_SETTINGS_SEARCH_ITEMS = [
  {
    id: "bots-bar",
    title: "Show Bots Bar",
    to: BOT_SETTINGS_PATH,
    searchTerms: ["Sidebar", "Bots", "机器人"],
  },
  {
    id: "bots-list",
    title: "Local Bots",
    to: BOT_SETTINGS_PATH,
    searchTerms: ["Bots", "机器人"],
  },
] as const;
