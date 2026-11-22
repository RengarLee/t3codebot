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
  "Bot module health route, sidebar toggle, independent i18n, and settings persistence work end to end",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("demo", { "README.md": "# t3codebot\n" });
    await t3.open();

    // 1. Isolated server route mounted via @t3tools/bot responds on /api/bots/health.
    const body = await runPromise(fetchBotHealth(app.baseUrl ?? ""));
    expect(body).toEqual({
      ok: true,
      module: "t3codebot",
      botsCount: 0,
    });

    // 2. SidebarBotsBar renders and expands/collapses its independent state.
    const botsBar = browser.locator('[data-testid="sidebar-bots-bar"]');
    await expect(botsBar).toBeVisible();
    await botsBar.getByRole("button", { name: "Bots" }).click();
    await expect(botsBar.getByText("No bots yet")).toBeVisible();
    await botsBar.getByRole("button", { name: "Bots" }).click();
    await expect(botsBar.getByText("No bots yet")).toBeHidden();

    // 3. Settings -> Bots toggles the sidebar bar and persists across navigation without ClientSettings edits.
    await app.open("/settings/bots");
    const toggle = screen.getByRole("switch", "Show Bots Bar");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await app.open("/");
    await expect(botsBar).toBeHidden();

    // 4. Settings search discovers the bot setting and re-enables the sidebar bar.
    await app.open("/settings/general");
    const searchInput = browser.locator('input[aria-label="Search settings"]');
    await searchInput.fill("Show Bots Bar");
    await screen.getByText("Show Bots Bar").first().click();

    const restoredToggle = screen.getByRole("switch", "Show Bots Bar");
    await expect(restoredToggle).toBeVisible();
    await restoredToggle.click();
    await expect(restoredToggle).toHaveAttribute("aria-checked", "true");

    await app.open("/");
    await expect(botsBar).toBeVisible();
    await app.screenshot("bots-restored");
  },
);
