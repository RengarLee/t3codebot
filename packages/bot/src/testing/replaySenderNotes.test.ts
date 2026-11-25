import { describe, expect, it } from "vite-plus/test";

import { materializeReplaySenderNotes } from "./replaySenderNotes.ts";

describe("materializeReplaySenderNotes", () => {
  it("updates recorded outbound prompts while preserving replies, commands, and protocol fields", () => {
    const entries = [
      {
        type: "expect_outbound",
        frame: { method: "turn/start", params: { input: [{ text: "Hello" }] } },
      },
      {
        type: "expect_outbound",
        frame: { message: "Hello\n\n<runtime_info>notes</runtime_info>" },
      },
      { type: "expect_outbound", frame: { message: "Hello there" } },
      { type: "expect_outbound", frame: { message: "/compact" } },
      { type: "emit_inbound", frame: { message: "Hello" } },
      {
        type: "expect_outbound",
        frame: {
          text: "<t3_code_instructions>notes</t3_code_instructions>\n\n<user_request>\nHello\n</user_request>",
        },
      },
      {
        type: "expect_outbound",
        frame: { message: "Interrupted:\n\n[user]\n\nHello\n\nNew request:\n\nWorld (again)." },
      },
    ];
    const messages = [
      { text: "Hello", annotatedText: "[user]\n\nHello" },
      { text: "/compact", annotatedText: "/compact" },
      { text: "World (again).", annotatedText: "[user]\n\nWorld (again)." },
    ];
    const result = materializeReplaySenderNotes(entries, messages);
    expect(result).toEqual([
      {
        type: "expect_outbound",
        frame: { method: "turn/start", params: { input: [{ text: "[user]\n\nHello" }] } },
      },
      {
        type: "expect_outbound",
        frame: { message: "[user]\n\nHello\n\n<runtime_info>notes</runtime_info>" },
      },
      ...entries.slice(2, 5),
      {
        type: "expect_outbound",
        frame: {
          text: "<t3_code_instructions>notes</t3_code_instructions>\n\n<user_request>\n[user]\n\nHello\n</user_request>",
        },
      },
      {
        type: "expect_outbound",
        frame: {
          message: "Interrupted:\n\n[user]\n\nHello\n\nNew request:\n\n[user]\n\nWorld (again).",
        },
      },
    ]);
    expect(materializeReplaySenderNotes(result, messages)).toEqual(result);
    expect(entries[0]?.frame).toEqual({
      method: "turn/start",
      params: { input: [{ text: "Hello" }] },
    });
  });
});
