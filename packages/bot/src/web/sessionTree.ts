export interface SessionTreeEntry {
  readonly id: string;
  readonly parentId: string;
}

export function layoutSessionTree(
  rootId: string,
  entries: ReadonlyArray<SessionTreeEntry>,
  narrow: boolean,
) {
  const children = new Map<string, string[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry.id);
    children.set(entry.parentId, siblings);
  }
  let leaf = 0;
  const visited = new Set<string>();
  const positions: Array<{ id: string; parentId: string | null; depth: number; slot: number }> = [];
  function visit(id: string, parentId: string | null, depth: number): number | null {
    if (visited.has(id)) return null;
    visited.add(id);
    const slots = (children.get(id) ?? []).flatMap((child) => {
      const slot = visit(child, id, depth + 1);
      return slot === null ? [] : [slot];
    });
    const slot = slots.length === 0 ? leaf++ : slots.reduce((a, b) => a + b, 0) / slots.length;
    positions.push({ id, parentId, depth, slot });
    return slot;
  }
  visit(rootId, null, 0);
  const nodes = positions.map((p) => ({
    ...p,
    x: narrow ? 16 + p.slot * 174 + (p.depth === 0 ? 35 : 0) : 16 + p.depth * 206,
    y: narrow ? 16 + p.depth * 104 : 16 + p.slot * 106 + (p.depth === 0 ? 14 : 0),
    width: p.depth === 0 ? 84 : 154,
    height: p.depth === 0 ? 34 : 62,
  }));
  return {
    nodes,
    width: Math.max(...nodes.map((n) => n.x + n.width)) + 16,
    height: Math.max(...nodes.map((n) => n.y + n.height)) + 16,
  };
}

export function sessionConnector(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
  narrow: boolean,
) {
  const a = narrow
    ? { x: from.x + from.width / 2, y: from.y + from.height }
    : { x: from.x + from.width, y: from.y + from.height / 2 };
  const b = narrow
    ? { x: to.x + to.width / 2, y: to.y - 6 }
    : { x: to.x - 6, y: to.y + to.height / 2 };
  const p = narrow ? { x: a.y, y: a.x } : a;
  const q = narrow ? { x: b.y, y: b.x } : b;
  const mid = (p.x + q.x) / 2,
    sign = Math.sign(q.y - p.y),
    r = Math.min(8, Math.abs(q.y - p.y) / 2, (q.x - p.x) / 2);
  const point = (x: number, y: number) => (narrow ? `${y} ${x}` : `${x} ${y}`);
  return {
    path: `M${point(p.x, p.y)}L${point(mid - r, p.y)}Q${point(mid, p.y)} ${point(mid, p.y + sign * r)}L${point(mid, q.y - sign * r)}Q${point(mid, q.y)} ${point(mid + r, q.y)}L${point(q.x, q.y)}`,
    arrow: narrow
      ? `M${b.x - 3} ${b.y}L${b.x} ${b.y + 6}L${b.x + 3} ${b.y}Z`
      : `M${b.x} ${b.y - 3}L${b.x + 6} ${b.y}L${b.x} ${b.y + 3}Z`,
  };
}
