import { expect, it, vi } from "vite-plus/test";
import { readBotFileHistory, restoreBotFile } from "./apiClient.ts";
import { skillErrorStatus } from "./useSkillResource.ts";

it("decodes history and restores using the current version; exposes conflicts", async () => {
  using fetch = vi.spyOn(globalThis, "fetch");
  fetch.mockResolvedValueOnce(
    Response.json({
      revisions: [
        {
          revision: 1,
          content: "old",
          trigger: "review",
          reason: "preference",
          threadId: "thread-1",
          createdAt: "2026-11-27T00:00:00Z",
        },
      ],
    }),
  );
  const options = { httpBaseUrl: "http://localhost:3773" };
  const history = await readBotFileHistory({ botId: "main", path: "USER.md" }, options);
  expect(history.revisions[0]?.content).toBe("old");
  fetch.mockResolvedValueOnce(
    Response.json({ file: { path: "USER.md", content: "old", version: "restored" } }),
  );
  expect(
    (
      await restoreBotFile(
        { botId: "main", path: "USER.md", revision: 1, expectedVersion: "current" },
        options,
      )
    ).file.version,
  ).toBe("restored");
  fetch.mockResolvedValueOnce(Response.json({ error: "Conflict" }, { status: 409 }));
  const error = await restoreBotFile(
    { botId: "main", path: "USER.md", revision: 1, expectedVersion: "stale" },
    options,
  ).catch((cause: unknown) => cause);
  expect(skillErrorStatus(error)).toBe(409);
});
