import type { GraphEdge, LabelNode } from "../types";

const MAX_DEPTH = 12;

/**
 * BFS from entry. Stops expanding past MAX_DEPTH (nodes at depth==MAX_DEPTH
 * are included but their outgoing edges are not followed).
 */
export function computeReachable(
  entryLabel: string,
  edges: GraphEdge[],
  labels: Record<string, LabelNode>,
): string[] {
  if (!labels[entryLabel] && !entryLabel) return [];

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }

  const order: string[] = [];
  const depth = new Map<string, number>();
  const queue: string[] = [];

  depth.set(entryLabel, 0);
  queue.push(entryLabel);

  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    const d = depth.get(id) ?? 0;
    if (d >= MAX_DEPTH) continue;
    for (const next of adj.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d + 1);
      queue.push(next);
    }
  }

  return order;
}

export function edgesWithinReachable(
  edges: GraphEdge[],
  reachableSet: Set<string>,
): GraphEdge[] {
  return edges.filter(
    (e) => reachableSet.has(e.from) && reachableSet.has(e.to),
  );
}
