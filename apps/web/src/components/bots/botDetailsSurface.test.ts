import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { useClosedViewStore } from "../../closedViewStore";
import { reopenClosedView } from "../../reopenClosedView";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";

it("keeps Bot details scoped to its environment and restores the closed tab", async () => {
  const home = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("home"));
  const remote = scopeThreadRef(EnvironmentId.make("remote"), home.threadId);
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {} });
  const panels = useRightPanelStore.getState();
  panels.open(home, "bot-details");
  panels.open(home, "bot-details");
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, home).surfaces,
  ).toEqual([{ id: "bot-details", kind: "bot-details" }]);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, remote).surfaces,
  ).toEqual([]);
  panels.closeSurface(home, "bot-details");
  const closed = useClosedViewStore.getState().entries[0];
  expect(closed?.kind).toBe("panel-tab");
  if (!closed) throw new Error("Missing closed Bot details");
  expect(
    await reopenClosedView(closed, {
      workspaceAvailable: false,
      openPreview: () => {
        throw new Error("Bot details must not open a browser");
      },
    }),
  ).toBe(true);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, home).surfaces,
  ).toEqual([{ id: "bot-details", kind: "bot-details" }]);
});
