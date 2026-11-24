// @effect-diagnostics nodeBuiltinImport:off - Reads the real sources the release patches.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { applyRebrandEdit, BOT_REBRAND_EDITS } from "./bot-rebrand.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

describe("bot-rebrand", () => {
  // Fails on the upstream sync that moves an anchor, instead of at release time.
  it.each(BOT_REBRAND_EDITS)("finds exactly one anchor in $file", (edit) => {
    const source = NodeFS.readFileSync(NodePath.join(repoRoot, edit.file), "utf8");
    expect(applyRebrandEdit(source, edit)).toContain(edit.to);
  });

  it("refuses a missing or repeated anchor", () => {
    const edit = { file: "x.ts", from: "a", to: "b" };
    expect(() => applyRebrandEdit("c", edit)).toThrow("found 0");
    expect(() => applyRebrandEdit("a a", edit)).toThrow("found 2");
  });

  it("inserts the replacement literally", () => {
    expect(applyRebrandEdit("x", { file: "x.ts", from: "x", to: "$&-${a}" })).toBe("$&-${a}");
  });
});
