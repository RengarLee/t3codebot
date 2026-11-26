import type { BotSummary, BotUpdateProfileRequest } from "@t3tools/bot/contracts";
import { expect, it, vi } from "vite-plus/test";

let currentBots: BotSummary[] = [];
const updateWorkingFoldersMock = vi.fn(
  async (botId: string, workingFolders: ReadonlyArray<string>) => {
    const existing = currentBots.find((bot) => bot.id === botId);
    if (!existing) throw new Error("Bot not found");
    const updated: BotSummary = { ...existing, workingFolders: [...workingFolders] };
    currentBots = currentBots.map((bot) => (bot.id === botId ? updated : bot));
    return { bot: updated };
  },
);
const updateProfileMock = vi.fn(async (botId: string, input: BotUpdateProfileRequest) => {
  const existing = currentBots.find((bot) => bot.id === botId);
  if (!existing) throw new Error("Bot not found");
  const updated: BotSummary = {
    ...existing,
    name: input.name ?? existing.name,
    summary: input.summary ?? existing.summary,
  };
  currentBots = currentBots.map((bot) => (bot.id === botId ? updated : bot));
  return { bot: updated };
});

vi.mock(import("@t3tools/bot/web/botList"), () => ({
  useBotList: () => currentBots,
}));
vi.mock(import("@t3tools/bot/web/apiClient"), async (importOriginal) => ({
  ...(await importOriginal()),
  updateBotWorkingFolders: (...args: Parameters<typeof updateWorkingFoldersMock>) =>
    updateWorkingFoldersMock(...args),
  updateBotProfile: (...args: Parameters<typeof updateProfileMock>) => updateProfileMock(...args),
}));

import { BotsSettingsView } from "@t3tools/bot/web/BotsSettingsView";
import { render } from "../../../test/render";

function resetFixture() {
  updateWorkingFoldersMock.mockClear();
  updateProfileMock.mockClear();
  currentBots = [
    {
      id: "main",
      role: "main",
      name: "Bot",
      status: "active",
      summary: "Main bot",
      inScope: [],
      outOfScope: [],
      workingFolders: [],
      version: "0.1.0",
      sessionMode: "fresh_per_run",
      skillsCount: 0,
      path: "/state/bots/main",
      projectId: "proj-main",
      homeThreadId: "home-main",
    },
    {
      id: "sub-1",
      role: "sub",
      name: "Researcher",
      status: "active",
      summary: "Reads docs and summarizes.",
      inScope: ["research"],
      outOfScope: [],
      workingFolders: ["/work/notes"],
      version: "0.1.0",
      sessionMode: "fresh_per_run",
      skillsCount: 0,
      path: "/state/bots/sub-1",
      projectId: "proj-sub-1",
      homeThreadId: null,
    },
  ];
}

it("lists bots like Projects, opens bot details, renames, adds via dialog, and removes folders", async () => {
  resetFixture();
  const view = () => (
    <BotsSettingsView locale="en" httpBaseUrl="http://127.0.0.1:3773" onOpenThread={() => {}} />
  );

  await using screen = await render(view());
  await expect.element(screen.getByTestId("settings-bot-row-main")).toBeVisible();
  await expect.element(screen.getByTestId("settings-bot-row-sub-1")).toBeVisible();

  await screen.getByTestId("settings-bot-row-main").click();
  await expect.element(screen.getByTestId("bot-detail-main")).toBeVisible();

  // Rename bot on blur / Enter
  const nameInput = screen.getByTestId("bot-name-input-main");
  await nameInput.fill("Chief");
  await screen.getByTestId("bot-folder-add-open-main").click();
  expect(updateProfileMock).toHaveBeenCalledWith(
    "main",
    { name: "Chief" },
    { httpBaseUrl: "http://127.0.0.1:3773" },
  );

  // Add folder via dialog
  await screen.getByTestId("bot-folder-input").fill("/work/reports");
  await screen.getByTestId("bot-folder-submit").click();
  expect(updateWorkingFoldersMock).toHaveBeenCalledWith("main", ["/work/reports"], {
    httpBaseUrl: "http://127.0.0.1:3773",
  });

  await screen.rerender(view());
  await expect.element(screen.getByText("/work/reports")).toBeVisible();

  // Back to list and open sub-bot detail to remove an existing folder
  await screen.getByTestId("bot-detail-back").click();
  await screen.getByTestId("settings-bot-row-sub-1").click();
  await screen.getByRole("button", { name: "Remove notes" }).click();
  expect(updateWorkingFoldersMock).toHaveBeenLastCalledWith("sub-1", [], {
    httpBaseUrl: "http://127.0.0.1:3773",
  });
});
