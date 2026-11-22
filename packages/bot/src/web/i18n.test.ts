import { describe, expect, it } from "vite-plus/test";

import { createBotTranslator, translateBotMessage } from "./i18n.ts";

describe("bot web i18n", () => {
  it("translates exact locales, falls back by base language, and defaults to English", () => {
    expect(translateBotMessage("zh", "bots.title")).toBe("机器人");
    expect(translateBotMessage("zh-CN", "bots.empty")).toBe("暂无机器人");
    expect(translateBotMessage("pt-BR", "bots.empty")).toBe("Nenhum bot ainda");
    expect(translateBotMessage("ja-JP", "bots.title")).toBe("ボット");
    expect(translateBotMessage("unknown-locale", "bots.settings.showBar.title")).toBe(
      "Show Bots Bar",
    );
    expect(translateBotMessage(undefined, "bots.title")).toBe("Bots");
  });

  it("creates a bound translator for the active locale", () => {
    const t = createBotTranslator("zh");
    expect(t("bots.settings.showBar.title")).toBe("显示机器人栏");
  });
});
