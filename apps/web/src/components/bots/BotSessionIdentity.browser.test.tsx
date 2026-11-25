import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

vi.mock(import("@t3tools/bot/web/botList"), () => ({
  useBotList: (url: string | null | undefined) => [
    {
      id: "bot",
      role: "sub" as const,
      name: url === "remote" ? "Remote reviewer" : "Local reviewer",
      status: "active",
      summary: "",
      inScope: [],
      outOfScope: [],
      workingFolders: [],
      version: "1",
      sessionMode: "session",
      skillsCount: 0,
      path: "",
      projectId: "bot-project",
      homeThreadId: "home",
    },
  ],
}));
vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentHttpBaseUrl: (id: string | null) => id,
}));

import { render } from "../../../test/render";
import { BotSessionIdentity } from "./BotSessionIdentity";

it("shows the owning bot in the selected environment and leaves ordinary threads and Home unlabelled", async () => {
  const identity = (environment: string, project: string, thread: string) => (
    <BotSessionIdentity
      environmentId={EnvironmentId.make(environment)}
      projectId={ProjectId.make(project)}
      threadId={ThreadId.make(thread)}
    />
  );
  await using screen = await render(identity("remote", "bot-project", "session"));
  await expect.element(screen.getByText("Remote reviewer")).toBeVisible();
  await screen.rerender(identity("local", "bot-project", "session"));
  await expect.element(screen.getByText("Local reviewer")).toBeVisible();
  await screen.rerender(identity("local", "ordinary-project", "session"));
  await expect.element(screen.getByTestId("bot-session-identity")).not.toBeInTheDocument();
  await screen.rerender(identity("local", "bot-project", "home"));
  await expect.element(screen.getByTestId("bot-session-identity")).not.toBeInTheDocument();
});
