export const BOT_SETTINGS_PATH = "/settings/bots" as const;

export const BOT_SETTINGS_SEARCH_ITEMS = [
  {
    id: "bots-bar",
    title: "Show Bot",
    to: BOT_SETTINGS_PATH,
    searchTerms: ["Sidebar", "Bots", "机器人"],
  },
  {
    id: "bots-main",
    title: "Bot",
    to: BOT_SETTINGS_PATH,
    searchTerms: [
      "Bots",
      "Bot",
      "Home",
      "Working folders",
      "Folders",
      "机器人",
      "工作文件夹",
      "目录",
    ],
  },
  {
    id: "bots-list",
    title: "Sub-bots",
    to: BOT_SETTINGS_PATH,
    searchTerms: [
      "Bots",
      "Sub-bots",
      "Working folders",
      "Folders",
      "机器人",
      "子 Bot",
      "工作文件夹",
    ],
  },
] as const;
