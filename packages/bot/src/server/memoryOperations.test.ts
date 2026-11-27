import { describe, expect, it } from "@effect/vitest";
import { applyMemoryOperations } from "./memoryOperations.ts";

describe("memory operations", () => {
  it("preserves free text while adding, deduplicating, replacing and removing facts", () => {
    const original = "My own notes\n\n- concise replies\n";
    expect(
      applyMemoryOperations(original, [
        { op: "add", scope: "user", old: "", text: "concise replies" },
      ]),
    ).toBe(original);
    expect(
      applyMemoryOperations(original, [
        { op: "replace", scope: "user", old: "concise replies", text: "Chinese replies" },
        { op: "add", scope: "user", old: "", text: "metric units" },
        { op: "remove", scope: "user", old: "Chinese replies", text: "" },
      ]),
    ).toBe("My own notes\n\n- metric units\n");
  });

  it("rejects stale or ambiguous replacements", () => {
    const operation = { op: "replace", scope: "bot", old: "old", text: "new" } as const;
    expect(() => applyMemoryOperations("- changed\n", [operation])).toThrow();
    expect(() => applyMemoryOperations("- old\n- old\n", [operation])).toThrow();
  });

  it("rejects sensitive content, multiline changes and UTF-8 overflow", () => {
    for (const text of [
      "password: example",
      "token=example",
      "密码：example",
      "sk-abcdefghijklmnop",
      "first\nsecond",
    ]) {
      expect(() =>
        applyMemoryOperations("", [{ op: "add", scope: "bot", old: "", text }]),
      ).toThrow();
    }
    expect(() =>
      applyMemoryOperations("中".repeat(1365), [{ op: "add", scope: "bot", old: "", text: "x" }]),
    ).toThrow("4 KB");
  });
});
