export const BOT_MESSAGES = {
  "bots.title": {
    en: "Bots",
    zh: "机器人",
    de: "Bots",
    es: "Bots",
    fr: "Bots",
    ja: "ボット",
    ko: "봇",
    "pt-BR": "Bots",
    ru: "Боты",
    sv: "Bottar",
  },
  "bots.empty": {
    en: "No bots yet",
    zh: "暂无机器人",
    de: "Noch keine Bots",
    es: "Aún no hay bots",
    fr: "Aucun bot pour le moment",
    ja: "ボットはまだありません",
    ko: "아직 봇이 없습니다",
    "pt-BR": "Nenhum bot ainda",
    ru: "Ботов пока нет",
    sv: "Inga bottar än",
  },
  "bots.settings.showBar.title": {
    en: "Show Bots Bar",
    zh: "显示机器人栏",
    de: "Bot-Leiste anzeigen",
    es: "Mostrar barra de bots",
    fr: "Afficher la barre des bots",
    ja: "ボットバーを表示",
    ko: "봇 바 표시",
    "pt-BR": "Mostrar barra de bots",
    ru: "Показывать панель ботов",
    sv: "Visa botfält",
  },
  "bots.settings.showBar.description": {
    en: "Show the bar below the search field in the sidebar.",
    zh: "在侧边栏搜索框下方显示机器人栏。",
    de: "Zeigt die Leiste unterhalb des Suchfelds in der Seitenleiste an.",
    es: "Muestra la barra debajo del campo de búsqueda en la barra lateral.",
    fr: "Affiche la barre sous le champ de recherche dans la barre latérale.",
    ja: "サイドバーの検索欄の下にボットバーを表示します。",
    ko: "사이드바 검색 입력란 아래에 봇 바를 표시합니다.",
    "pt-BR": "Mostra a barra abaixo do campo de busca na barra lateral.",
    ru: "Показывать панель под полем поиска в боковой панели.",
    sv: "Visar fältet under sökfältet i sidopanelen.",
  },
  "bots.create.title": {
    en: "Create bot",
    zh: "创建机器人",
  },
  "bots.create.paletteDescription": {
    en: "Give a new bot a name and a purpose",
    zh: "为新机器人设置名称和作用",
  },
  "bots.create.newBot": {
    en: "New bot",
    zh: "新机器人",
  },
  "bots.create.namePlaceholder": {
    en: "Bot name",
    zh: "机器人名称",
  },
  "bots.create.nameHint": {
    en: "Next, describe what it does",
    zh: "下一步填写机器人的作用",
  },
  "bots.create.purposePlaceholder": {
    en: "What does this bot do?",
    zh: "机器人的作用",
  },
  "bots.create.purposeHint": {
    en: "Describe what this bot is responsible for",
    zh: "描述这个机器人负责做什么",
  },
  "bots.create.nameEmptyHint": {
    en: "Enter a bot name and press Enter to continue.",
    zh: "输入机器人名称，按 Enter 继续。",
  },
  "bots.create.purposeEmptyHint": {
    en: "Describe what the bot does and press Enter to create it.",
    zh: "描述机器人的作用，按 Enter 创建。",
  },
  "bots.create.next": {
    en: "Next",
    zh: "下一步",
  },
  "bots.create.submit": {
    en: "Create",
    zh: "创建",
  },
  "bots.create.creating": {
    en: "Creating",
    zh: "创建中",
  },
  "bots.create.failed": {
    en: "Could not create the bot.",
    zh: "创建机器人失败。",
  },
  "bots.home.openFailed": {
    en: "Couldn't open Home",
    zh: "无法打开 Home",
    de: "Home konnte nicht geöffnet werden",
    es: "No se pudo abrir Home",
    fr: "Impossible d'ouvrir Home",
    ja: "Home を開けませんでした",
    ko: "Home을 열 수 없습니다",
    "pt-BR": "Não foi possível abrir o Home",
    ru: "Не удалось открыть Home",
    sv: "Det gick inte att öppna Home",
  },
  "bots.list.title": {
    en: "Local Bots",
    zh: "本地机器人",
  },
  "bots.overview.active": {
    en: "Active",
    zh: "活动中",
  },
  "bots.overview.running": {
    en: "Running",
    zh: "运行中",
  },
  "bots.overview.done": {
    en: "Done",
    zh: "已完成",
  },
  "bots.overview.noSessions": {
    en: "No sessions yet",
    zh: "暂无会话",
  },
  "bots.overview.settled": {
    en: "Settled",
    zh: "已收尾",
  },
} as const;

export type BotMessageKey = keyof typeof BOT_MESSAGES;

function resolveLocaleTag(locale: string | undefined): string {
  const normalized = locale?.trim();
  if (!normalized) return "en";
  return normalized;
}

export function translateBotMessage(locale: string | undefined, key: BotMessageKey): string {
  const entry: Record<string, string> = BOT_MESSAGES[key];
  const tag = resolveLocaleTag(locale);
  const exact = entry[tag];
  if (exact !== undefined) return exact;
  const language = tag.split("-", 1)[0];
  if (language) {
    const byLanguage = entry[language];
    if (byLanguage !== undefined) return byLanguage;
  }
  return BOT_MESSAGES[key].en;
}

export function createBotTranslator(locale: string | undefined) {
  return (key: BotMessageKey): string => translateBotMessage(locale, key);
}
