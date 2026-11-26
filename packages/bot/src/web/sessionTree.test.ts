import { describe, expect, it } from "vite-plus/test";
import { layoutSessionTree } from "./sessionTree.ts";

describe("session tree layout", () => {
  it("keeps recursive branches separate on both axes and excludes unrelated sessions", () => {
    const entries = [
      { id: "a", parentId: "home" },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "a" },
      { id: "d", parentId: "b" },
      { id: "other", parentId: "other-home" },
      { id: "home", parentId: "d" },
    ];
    for (const narrow of [false, true]) {
      const { nodes } = layoutSessionTree("home", entries, narrow);
      expect(new Set(nodes.map((node) => node.id))).toEqual(new Set(["home", "a", "b", "c", "d"]));
      for (const node of nodes)
        for (const other of nodes) {
          if (node.id === other.id) continue;
          expect(
            node.x + node.width <= other.x ||
              other.x + other.width <= node.x ||
              node.y + node.height <= other.y ||
              other.y + other.height <= node.y,
          ).toBe(true);
        }
    }
  });
});
