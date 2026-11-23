import { EventId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { mapDomainEvent } from "./botHostAdapter.ts";

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
});
