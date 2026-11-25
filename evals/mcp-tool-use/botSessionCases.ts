import { ThreadId, withMessageSenderNote } from "@t3tools/contracts";

import {
  renderMainBotInstructions,
  renderSubBotInstructions,
} from "../../packages/bot/src/server/template.ts";
import type { McpToolUseCase } from "./run.ts";

export const botSessionCases: ReadonlyArray<McpToolUseCase> = ["main", "sub"].flatMap((owner) => {
  const context =
    owner === "main"
      ? renderMainBotInstructions([])
      : renderSubBotInstructions(
          {
            name: "Tutor",
            summary: "Teaches English.",
            inScope: ["English practice"],
            outOfScope: [],
          },
          [],
        );
  return ["user", "agent"].map((sender) => ({
    id: `bot-session-${owner}-${sender}`,
    area: "bot-session",
    kind: sender === "user" ? "bad" : "control",
    pattern: "current-message-sender",
    experience:
      "A user enters a Bot-created session after MainBot's initial dispatch; the session must address the current sender.",
    source: {
      request:
        "Distinguish MainBot coordination from direct user conversation in Bot-created sessions.",
    },
    setup: {
      role: "top",
      context,
      priorTurns: [
        {
          role: "user",
          text: withMessageSenderNote(
            {
              createdBy: "agent",
              creationSource: "mcp",
              senderThreadId: ThreadId.make("mainbot-home"),
            },
            "[Bot session] Help the user practice English here. Return a receipt with status, outcome and artifacts when reporting to MainBot.",
          ),
        },
        {
          role: "assistant",
          text: '{"status":"needs_decision","outcome":"Ready for English practice.","artifacts":[]}',
        },
      ],
    },
    prompt: withMessageSenderNote(
      sender === "user"
        ? { createdBy: "user", creationSource: "web" }
        : {
            createdBy: "agent",
            creationSource: "mcp",
            senderThreadId: ThreadId.make("mainbot-home"),
          },
      "Before we continue, identify who sent this current message. Answer only HUMAN if it came directly from the person, or MAINBOT if it came from the coordinating agent. Do not use tools.",
    ),
    expect: {
      finalTextMust: [sender === "user" ? "^\\s*HUMAN\\s*$" : "^\\s*MAINBOT\\s*$"],
      callsMustNot: [
        { tool: "t3_thread_send" },
        { tool: "t3_thread_launch" },
        { tool: "delegate_task" },
        { tool: "t3_submit_output" },
      ],
    },
    maxSteps: 2,
  }));
});
