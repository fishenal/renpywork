import type { DialogueLine, StagedStructureOp } from "./types";

/** Max undo snapshots — keeps memory bounded for long sessions. */
export const EDITOR_HISTORY_LIMIT = 40;

export type EditorSnapshot = {
  draftsZh: Record<string, string>;
  draftsEn: Record<string, string>;
  draftsSpeaker: Record<string, string | null>;
  draftsStatement: Record<string, string>;
  structureOps: StagedStructureOp[];
  pendingLines: Record<string, DialogueLine>;
  pendingSeq: number;
};

export type EditorHistory = {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
};

export function emptyHistory(): EditorHistory {
  return { past: [], future: [] };
}

export function cloneSnapshot(s: EditorSnapshot): EditorSnapshot {
  return {
    draftsZh: { ...s.draftsZh },
    draftsEn: { ...s.draftsEn },
    draftsSpeaker: { ...s.draftsSpeaker },
    draftsStatement: { ...s.draftsStatement },
    structureOps: s.structureOps.map((op) => ({ ...op })),
    pendingLines: { ...s.pendingLines },
    pendingSeq: s.pendingSeq,
  };
}

export function pushSnapshot(
  history: EditorHistory,
  snapshot: EditorSnapshot,
  limit = EDITOR_HISTORY_LIMIT,
): EditorHistory {
  const past = [...history.past, cloneSnapshot(snapshot)];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, future: [] };
}

export function undoHistory(
  history: EditorHistory,
  current: EditorSnapshot,
): { history: EditorHistory; snapshot: EditorSnapshot } | null {
  if (history.past.length === 0) return null;
  const past = [...history.past];
  const snapshot = past.pop()!;
  return {
    history: {
      past,
      future: [...history.future, cloneSnapshot(current)],
    },
    snapshot,
  };
}

export function redoHistory(
  history: EditorHistory,
  current: EditorSnapshot,
): { history: EditorHistory; snapshot: EditorSnapshot } | null {
  if (history.future.length === 0) return null;
  const future = [...history.future];
  const snapshot = future.pop()!;
  return {
    history: {
      past: [...history.past, cloneSnapshot(current)],
      future,
    },
    snapshot,
  };
}
