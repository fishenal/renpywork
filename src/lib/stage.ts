import type { DialogueLine, StagedStructureOp } from "./types";

export function isPendingId(id: string): boolean {
  return id.startsWith("pending:");
}

/** Collect insert ids that are chained after `rootId` (inclusive of direct children). */
export function collectInsertDescendants(
  rootId: string,
  inserts: StagedStructureOp[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const op of inserts) {
    if (op.op !== "insert") continue;
    const list = children.get(op.afterId) ?? [];
    list.push(op.id);
    children.set(op.afterId, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

/**
 * Build visible timeline for a file: base lines minus deletes, with pending
 * inserts spliced after their anchors (supports insert-after-insert).
 */
export function buildVisibleLines(
  baseLines: DialogueLine[],
  file: string,
  deletedIds: Set<string>,
  pendingById: Record<string, DialogueLine>,
  insertOps: Extract<StagedStructureOp, { op: "insert" }>[],
): DialogueLine[] {
  const base = baseLines.filter((l) => l.file === file && !deletedIds.has(l.id));
  const inserts = insertOps.filter(
    (op) => op.file === file && !deletedIds.has(op.id) && pendingById[op.id],
  );

  const children = new Map<string, string[]>();
  for (const op of inserts) {
    const list = children.get(op.afterId) ?? [];
    list.push(op.id);
    children.set(op.afterId, list);
  }

  const out: DialogueLine[] = [];

  function appendChain(afterId: string) {
    for (const id of children.get(afterId) ?? []) {
      const line = pendingById[id];
      if (!line || deletedIds.has(id)) continue;
      out.push(line);
      appendChain(id);
    }
  }

  for (const line of base) {
    out.push(line);
    appendChain(line.id);
  }

  return out;
}

/** Apply chronological swap ops to a visible line list (same file). */
export function applySwapOps(
  lines: DialogueLine[],
  swaps: Extract<StagedStructureOp, { op: "swap" }>[],
): DialogueLine[] {
  if (swaps.length === 0) return lines;
  const arr = [...lines];
  for (const swap of swaps) {
    const i = arr.findIndex((l) => l.id === swap.a);
    const j = arr.findIndex((l) => l.id === swap.b);
    if (i < 0 || j < 0) continue;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
