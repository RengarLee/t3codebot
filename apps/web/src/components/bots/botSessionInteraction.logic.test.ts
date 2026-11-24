import { BOT_WAKE_NOTIFICATION_DETAIL, isHiddenBotWakeNotification } from "@t3tools/bot/contracts";
import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMessagesTimelineRows } from "../chat/MessagesTimeline.logic";
import { isBotSessionThread } from "./useBotSessionChip";

type TimelineEntry = Parameters<typeof deriveMessagesTimelineRows>[0]["timelineEntries"][number];

const at = (seconds: number) => `2026-11-23T00:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("bot session interaction", () => {
  it("identifies one-off and sub-bot sessions while excluding Home", () => {
    const bots = [
      { projectId: "proj-main", homeThreadId: "thread-home" },
      { projectId: "proj-sub", homeThreadId: null },
    ];
    expect(isBotSessionThread(bots, "proj-main", "thread-home")).toBe(false);
    expect(isBotSessionThread(bots, "proj-main", "thread-oneoff")).toBe(true);
    expect(isBotSessionThread(bots, "proj-sub", "thread-sub-session")).toBe(true);
    expect(isBotSessionThread(bots, "proj-other", "thread-normal")).toBe(false);
    expect(isBotSessionThread(bots, null, "thread-normal")).toBe(false);
  });

  it("hides bot receipt wake notification rows while keeping normal notifications and replies", () => {
    expect(
      isHiddenBotWakeNotification({ type: "notification", detail: BOT_WAKE_NOTIFICATION_DETAIL }),
    ).toBe(true);
    expect(isHiddenBotWakeNotification({ type: "notification", detail: "other" })).toBe(false);
    expect(
      isHiddenBotWakeNotification({ type: "user_message", detail: BOT_WAKE_NOTIFICATION_DETAIL }),
    ).toBe(false);

    const botWake: TimelineEntry = {
      id: "wake-bot",
      kind: "work",
      createdAt: at(10),
      entry: {
        id: "wake-bot",
        createdAt: at(10),
        runId: RunId.make("run-bot-wake"),
        label: "Weekly PRs",
        tone: "info",
        itemType: "notification",
        projectedItem: {
          visibility: "local",
          item: {
            type: "notification",
            detail: BOT_WAKE_NOTIFICATION_DETAIL,
          },
        } as never,
      },
    };
    const reply: TimelineEntry = {
      id: "reply-1",
      kind: "message",
      createdAt: at(12),
      message: {
        id: MessageId.make("reply-1"),
        role: "assistant",
        text: "Done! [Weekly PRs](t3-thread://v1/session-1)",
        createdAt: at(12),
        updatedAt: at(12),
        streaming: false,
        runId: RunId.make("run-bot-wake"),
      },
    };
    const normalWake: TimelineEntry = {
      id: "wake-normal",
      kind: "work",
      createdAt: at(20),
      entry: {
        id: "wake-normal",
        createdAt: at(20),
        runId: RunId.make("run-normal"),
        label: "Command finished",
        tone: "info",
        itemType: "notification",
        projectedItem: {
          visibility: "local",
          item: {
            type: "notification",
            detail: undefined,
          },
        } as never,
      },
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [botWake, reply, normalWake],
      isWorking: false,
      activeTurnStartedAt: null,
      latestRun: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      toolCallVisibility: "showAll",
    });

    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain("wake-bot");
    expect(ids).toContain("reply-1");
    expect(ids).toContain("wake-normal");
  });
});
