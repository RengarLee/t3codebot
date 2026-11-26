import {
  BotSessionsPanel,
  BotActivityPanel,
  BotSessionMap,
  type BotSessionControlProps,
} from "@t3tools/bot/web/BotSessionsPanel";
import { fetchBotSessions } from "@t3tools/bot/web/apiClient";
import { getBotClientPreferences, resetBotClientPreferences } from "@t3tools/bot/web/preferences";
import { ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { act, render } from "../../../test/render";
import "~/index.css";

vi.mock(import("@t3tools/bot/web/apiClient"), () => ({ fetchBotSessions: vi.fn() }));

function Control({ label, onClick, disabled }: BotSessionControlProps) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

it("anchors the activity timeline, restores history on return, and switches graph selection", async () => {
  resetBotClientPreferences();
  const shell: OrchestrationV2ThreadShell = {
    ...makeThreadProjectionFixture().thread,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
  };
  const session = (index: number, parent = "home") => ({
    parentThreadId: ThreadId.make(parent),
    thread: {
      ...shell,
      id: ThreadId.make(`session-${index}`),
      title: `Session ${index}`,
      createdAt: DateTime.makeUnsafe(`2026-11-26T00:${String(index + 2).padStart(2, "0")}:00.000Z`),
    },
  });
  const current = Array.from({ length: 40 }, (_, index) => session(index));
  const older = [session(-2), session(-1)];
  const child = session(45, "session-39");
  const request = vi.mocked(fetchBotSessions);
  request.mockReset();
  request.mockImplementation(async (input) =>
    input.descendants
      ? { sessions: [child], hasMore: false }
      : { sessions: input.cursor ? older : current, hasMore: input.cursor === undefined },
  );
  const onOpen = vi.fn();
  const view = (revision: string) => (
    <BotSessionsPanel
      homeThreadId={ThreadId.make("home")}
      httpBaseUrl="http://remote.example"
      locale="en"
      revision={revision}
      botName={() => "Bot A"}
      renderStatus={() => "Ready"}
      onOpen={onOpen}
      Control={Control}
    />
  );
  await using screen = await render(view("first"));
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(40),
  );
  const panel = screen.container.querySelector('[data-testid="bot-sessions"]');
  const list = panel?.children[1];
  if (!(list instanceof HTMLElement)) throw new Error("Missing session viewport");
  expect(list.scrollTop).toBeGreaterThan(0);
  expect(Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop)).toBeLessThan(2);
  await act(() => {
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const initialRow = screen.container.querySelector('[data-testid="bot-session-row"]');
  if (!(initialRow instanceof HTMLElement)) throw new Error("Missing first session");
  const before = initialRow.getBoundingClientRect().top;
  await screen.getByRole("button", { name: "Load older sessions" }).click();
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(42),
  );
  expect(Math.abs(initialRow.getBoundingClientRect().top - before)).toBeLessThan(2);
  const readingPosition = list.scrollTop;
  request.mockImplementation(async (input) =>
    input.descendants
      ? { sessions: [child], hasMore: false }
      : {
          sessions: input.cursor ? older : [...current, session(40)],
          hasMore: input.cursor === undefined,
        },
  );
  await screen.rerender(view("new-session"));
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(43),
  );
  expect(list.scrollTop).toBe(readingPosition);
  expect(screen.container.querySelectorAll("time")).toHaveLength(43);
  await screen.getByRole("button", { name: "View activity", exact: true }).nth(41).click();
  expect(onOpen).toHaveBeenCalledWith(current[39]!.thread);
  const savedPosition = list.scrollTop;
  await screen.unmount();
  await using returned = await render(view("returned"));
  await vi.waitFor(() =>
    expect(returned.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(43),
  );
  const restored = returned.container.querySelector('[data-testid="bot-sessions"]')?.children[1];
  if (!(restored instanceof HTMLElement)) throw new Error("Missing restored activity viewport");
  expect(Math.abs(restored.scrollTop - savedPosition)).toBeLessThan(2);
  const graph = (selectedThreadId: typeof child.thread.id) => (
    <div className="flex h-[300px] flex-col">
      <BotSessionMap
        homeThreadId={ThreadId.make("home")}
        httpBaseUrl="http://remote.example"
        locale="en"
        revision="graph"
        root={current[39]!.thread}
        selectedThreadId={selectedThreadId}
        botName={() => "Bot A"}
        renderStatus={() => "Ready"}
        onOpen={onOpen}
        Control={Control}
      />
    </div>
  );
  await returned.rerender(graph(current[39]!.thread.id));
  await returned.getByRole("button", { name: "Session 45 Bot A Ready" }).click();
  expect(onOpen).toHaveBeenLastCalledWith(child.thread);
  const canvas = returned.container.querySelector('[role="group"]');
  await returned.rerender(graph(child.thread.id));
  expect(returned.container.querySelector('[role="group"]')).toBe(canvas);
  await expect
    .element(returned.getByRole("button", { name: "Session 45 Bot A Ready" }))
    .toHaveAttribute("aria-pressed", "true");
  await returned.rerender(
    <div className="flex h-[680px] flex-col">
      <textarea aria-label="Main chat draft" defaultValue="Keep the main conversation" />
      <BotActivityPanel
        homeThreadId={ThreadId.make("home")}
        httpBaseUrl="http://remote.example"
        locale="en"
        revision="panel"
        botName={() => "Bot A"}
        renderStatus={() => "Ready"}
        resolveThread={(thread) => thread}
        Control={Control}
        renderConversation={(thread) => (
          <div data-testid="embedded-conversation">{thread.title}</div>
        )}
      />
    </div>,
  );
  await vi.waitFor(() =>
    expect(returned.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(43),
  );
  const mainDraft = returned.container.querySelector("textarea");
  const mainLocation = returned.router?.state.location.href;
  await returned.getByRole("button", { name: "View activity", exact: true }).nth(41).click();
  await expect
    .element(returned.getByTestId("embedded-conversation"))
    .toHaveTextContent("Session 39");
  await returned.getByRole("button", { name: "Session 45 Bot A Ready" }).click();
  await expect
    .element(returned.getByTestId("embedded-conversation"))
    .toHaveTextContent("Session 45");
  expect(returned.router?.state.location.href).toBe(mainLocation);
  expect(returned.container.querySelector("textarea")).toBe(mainDraft);
  await expect
    .element(returned.getByRole("textbox", { name: "Main chat draft" }))
    .toHaveValue("Keep the main conversation");
  const separator = returned.getByRole("separator", {
    name: "Resize session map and conversation",
  });
  const map = returned.getByRole("region", { name: "Session chain" }).element();
  const conversation = returned.getByTestId("embedded-conversation").element();
  const initialHeight = map.getBoundingClientRect().height;
  await separator.click();
  await userEvent.keyboard("{ArrowDown}");
  await vi.waitFor(() =>
    expect(map.getBoundingClientRect().height).toBeGreaterThan(initialHeight + 10),
  );
  expect(returned.getByTestId("embedded-conversation").element()).toBe(conversation);
  await userEvent.keyboard("{End}");
  expect(conversation.parentElement!.getBoundingClientRect().height).toBeGreaterThanOrEqual(159);
  await userEvent.keyboard("{Home}");
  expect(map.getBoundingClientRect().height).toBeGreaterThanOrEqual(111);
  await userEvent.keyboard("{ArrowDown}");
  const savedRatio = getBotClientPreferences().activityMapRatio;
  const resizedHeight = map.getBoundingClientRect().height;
  await returned.getByRole("button", { name: "Back to activity" }).click();
  await expect.element(returned.getByTestId("embedded-conversation")).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(returned.container.querySelectorAll('[data-testid="bot-session-row"]')).toHaveLength(43),
  );
  await returned.getByRole("button", { name: "View activity", exact: true }).nth(41).click();
  await expect
    .element(separator)
    .toHaveAttribute("aria-valuenow", String(Math.round(savedRatio! * 100)));
  expect(
    Math.abs(
      returned.getByRole("region", { name: "Session chain" }).element().getBoundingClientRect()
        .height - resizedHeight,
    ),
  ).toBeLessThan(2);
  await userEvent.dblClick(separator);
  expect(getBotClientPreferences().activityMapRatio).toBeUndefined();
  await expect.element(separator).toHaveAttribute("aria-valuenow", "28");
});
