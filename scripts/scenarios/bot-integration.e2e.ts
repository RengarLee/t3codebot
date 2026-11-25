import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { runPromise, test, WEB } from "./t3.ts";

const BotHealthSchema = Schema.Struct({
  ok: Schema.Literal(true),
  module: Schema.Literal("t3codebot"),
  botsCount: Schema.Int,
});

const fetchBotHealth = (baseUrl: string) =>
  HttpClient.get(`${baseUrl}/api/bots/health`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(BotHealthSchema)),
    Effect.provide(FetchHttpClient.layer),
  );

test(
  "Bot is the only sidebar bot entry and bot creation is gone from the palette and Settings",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("demo", { "README.md": "# t3codebot\n" });
    await t3.open();

    // 1. The server guarantees the Bot before any client asks for it.
    const body = await runPromise(fetchBotHealth(app.baseUrl ?? ""));
    expect(body).toEqual({ ok: true, module: "t3codebot", botsCount: 1 });

    // 2. The sidebar shows the single Bot entry; sub-bots never appear there.
    const botsBar = browser.locator('[data-testid="sidebar-bots-bar"]');
    const mainBot = browser.locator(
      '[data-testid="sidebar-bots-bar"] [data-testid="sidebar-main-bot"]',
    );
    await expect(mainBot).toBeVisible();
    await expect(mainBot).toHaveText(/^Bot$/);
    await expect(browser.locator('[data-testid="sidebar-bots-bar"] button')).toHaveCount(1);

    // 3. The add-project palette no longer offers "Create bot".
    await screen.getByRole("combobox", "Projects").tap();
    await screen.getByRole("option", "Add project").tap();
    await expect(screen.getByText("Git URL")).toBeVisible();
    await expect(screen.getByText("Create bot")).toBeHidden();
    await browser.keyboard.press("Escape");

    // 4. Settings -> Bots lists the Bot with no create control, and toggles the sidebar entry.
    await app.open("/settings/bots");
    await expect(browser.locator('[data-testid="settings-bot-row-main"]')).toBeVisible();
    await expect(screen.getByText("Create bot")).toBeHidden();
    const toggle = screen.getByRole("switch", "Show Bot");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await app.open("/");
    await expect(botsBar).toBeHidden();

    // 5. Settings search finds the setting and restores the entry.
    await app.open("/settings/general");
    await browser.locator('input[aria-label="Search settings"]').fill("Show Bot");
    await screen.getByText("Show Bot").first().click();
    const restoredToggle = screen.getByRole("switch", "Show Bot");
    await restoredToggle.click();
    await expect(restoredToggle).toHaveAttribute("aria-checked", "true");
    await app.open("/");
    await expect(mainBot).toBeVisible();
    await app.screenshot("main-bot-entry");
  },
);
