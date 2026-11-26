import { createBotTranslator } from "@t3tools/bot/web/i18n";
import { getI18nSnapshot } from "../../i18n/runtime";

export const botDetailsPanelTitle = () =>
  createBotTranslator(getI18nSnapshot().locale)("bots.sessions.details");
