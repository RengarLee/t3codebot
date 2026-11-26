import {
  EventId,
  RunId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { mapDomainEvent, toHostThreadMessages } from "./botHostAdapter.ts";

const message = (fields: Record<string, unknown>) =>
  ({ streaming: false, ...fields }) as unknown as OrchestrationV2ConversationMessage;

describe("bot host adapter", () => {
  it("hands the bot a run's submitted output value, not T3's output envelope", () => {
    const receipt = { status: "done", outcome: "Created bye.md.", artifacts: ["notes/bye.md"] };
    expect(
      mapDomainEvent({
        id: EventId.make("event-1"),
        threadId: ThreadId.make("thread-1"),
        occurredAt: DateTime.makeUnsafe("2026-11-23T00:00:00.000Z"),
        type: "run.output-submitted",
        payload: {
          runId: RunId.make("run-1"),
          output: { value: receipt, submittedAt: "2026-11-23T00:00:00.000Z" },
        },
      }),
    ).toEqual({ type: "run_output", threadId: "thread-1", runId: "run-1", output: receipt });
  });

  it("reads a thread as the chat a person sees: finished user and assistant text, in order", () => {
    expect(
      toHostThreadMessages([
        message({ id: "m1", role: "user", text: "Fix it", createdBy: "user" }),
        message({ id: "m2", role: "system", text: "Context", createdBy: "agent" }),
        message({ id: "m3", role: "assistant", text: "Working", createdBy: "agent" }),
        message({ id: "m4", role: "assistant", text: "   ", createdBy: "agent" }),
        message({
          id: "m5",
          role: "assistant",
          text: "Partial",
          createdBy: "agent",
          streaming: true,
        }),
        message({ id: "m6", role: "user", text: "Task from Home", createdBy: "agent" }),
        message({ id: "m7", role: "user", text: "Unknown author" }),
      ]),
    ).toEqual([
      { id: "m1", role: "user", text: "Fix it", createdBy: "user" },
      { id: "m3", role: "assistant", text: "Working", createdBy: "agent" },
      { id: "m6", role: "user", text: "Task from Home", createdBy: "agent" },
      { id: "m7", role: "user", text: "Unknown author", createdBy: null },
    ]);
  });
});
