import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ canOperate: true, settle: vi.fn(), unsettle: vi.fn() }));
vi.mock(import("../../hooks/useThreadActions"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    useThreadActions: () => ({
      ...original.useThreadActions(),
      settleThread: state.settle,
      unsettleThread: state.unsettle,
    }),
  };
});
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => state.canOperate,
}));

import { render } from "../../../test/render";
import { ThreadSettleButton } from "./BotSessionSettleControl";

it("settles the referenced session and removes settlement without opening the link", async () => {
  state.canOperate = true;
  state.settle.mockReset().mockResolvedValue({ _tag: "Success" });
  state.unsettle.mockReset().mockResolvedValue({ _tag: "Success" });
  const threadRef = {
    environmentId: EnvironmentId.make("remote"),
    threadId: ThreadId.make("session"),
  };
  const open = vi.fn();
  const content = (settled: boolean) => (
    <span onClick={open}>
      <ThreadSettleButton threadRef={threadRef} settled={settled} compact />
    </span>
  );
  await using screen = await render(content(false));
  await screen.getByRole("button", { name: "Settle thread" }).click();
  expect(state.settle).toHaveBeenCalledWith(threadRef);
  expect(open).not.toHaveBeenCalled();
  await screen.rerender(content(true));
  await expect
    .element(screen.getByRole("button", { name: "Un-settle thread" }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", { name: "Un-settle thread" }).click();
  expect(state.unsettle).toHaveBeenCalledWith(threadRef);
  expect(open).not.toHaveBeenCalled();
});

it("hides the mutation from read-only viewers", async () => {
  state.canOperate = false;
  await using screen = await render(
    <ThreadSettleButton
      threadRef={{
        environmentId: EnvironmentId.make("remote"),
        threadId: ThreadId.make("session"),
      }}
      settled={false}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Settle thread" }))
    .not.toBeInTheDocument();
});
