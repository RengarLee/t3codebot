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
