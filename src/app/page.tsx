"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AppNav } from "@/components/AppNav";
import { BranchGraph } from "@/components/BranchGraph";
import { FileList } from "@/components/FileList";
import { LineEditor } from "@/components/LineEditor";
import { ProjectPicker, pushRecent } from "@/components/ProjectPicker";
import {
  emptyHistory,
  pushSnapshot,
  redoHistory,
  undoHistory,
  type EditorHistory,
  type EditorSnapshot,
} from "@/lib/history";
import {
  applySwapOps,
  buildVisibleLines,
  collectInsertDescendants,
  isPendingId,
} from "@/lib/stage";
import type {
  DialogueLine,
  ProjectIndex,
  ProjectSession,
  StagedStructureOp,
} from "@/lib/types";

type Toast = { kind: "ok" | "error"; message: string } | null;

const GRAPH_HEIGHT_KEY = "renpywork.graphHeight";
const GRAPH_COLLAPSED_KEY = "renpywork.graphCollapsed";
const GRAPH_HEIGHT_DEFAULT = 280;
const GRAPH_HEIGHT_MIN = 140;
const GRAPH_HEIGHT_MAX_RATIO = 0.72;

function defaultFileForIndex(index: ProjectIndex): string | null {
  if (index.entryLabel && index.labels[index.entryLabel]?.file) {
    return index.labels[index.entryLabel].file;
  }
  const withLines = index.files.find((f) =>
    index.lines.some((l) => l.file === f),
  );
  return withLines ?? index.files[0] ?? null;
}

function statementBase(line: DialogueLine): string {
  if (line.kind === "scene") return `scene ${line.text}`.trim();
  if (line.kind === "play_music") return `play music ${line.text}`.trim();
  if (line.kind === "play_sound") return `play sound ${line.text}`.trim();
  if (line.kind === "play_ambient") return `play ambient ${line.text}`.trim();
  if (line.kind === "show" || line.kind === "hide") {
    return `${line.kind} ${line.text}`.trim();
  }
  return line.text;
}

function isStatementKind(kind: DialogueLine["kind"]): boolean {
  return (
    kind === "show" ||
    kind === "hide" ||
    kind === "scene" ||
    kind === "play_music" ||
    kind === "play_sound" ||
    kind === "play_ambient"
  );
}

export default function HomePage() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [draftsZh, setDraftsZh] = useState<Record<string, string>>({});
  const [draftsEn, setDraftsEn] = useState<Record<string, string>>({});
  const [draftsSpeaker, setDraftsSpeaker] = useState<
    Record<string, string | null>
  >({});
  /** Full `show …` / `hide …` statement drafts (no indent) */
  const [draftsStatement, setDraftsStatement] = useState<
    Record<string, string>
  >({});
  /** Chronological structure ops (pending until Save) */
  const [structureOps, setStructureOps] = useState<StagedStructureOp[]>([]);
  const [pendingLines, setPendingLines] = useState<
    Record<string, DialogueLine>
  >({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [graphHeight, setGraphHeight] = useState(GRAPH_HEIGHT_DEFAULT);
  const leftPaneRef = useRef<HTMLElement | null>(null);
  const rightPaneRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const pendingSeq = useRef(0);
  const [history, setHistory] = useState<EditorHistory>(() => emptyHistory());
  const applyingHistory = useRef(false);
  /** Coalesce rapid text edits into one undo step */
  const typingBurst = useRef(false);
  const typingBurstTimer = useRef<number | null>(null);

  const snapshotRef = useRef<EditorSnapshot>({
    draftsZh: {},
    draftsEn: {},
    draftsSpeaker: {},
    draftsStatement: {},
    structureOps: [],
    pendingLines: {},
    pendingSeq: 0,
  });

  useLayoutEffect(() => {
    snapshotRef.current = {
      draftsZh,
      draftsEn,
      draftsSpeaker,
      draftsStatement,
      structureOps,
      pendingLines,
      pendingSeq: pendingSeq.current,
    };
  }, [
    draftsZh,
    draftsEn,
    draftsSpeaker,
    draftsStatement,
    structureOps,
    pendingLines,
  ]);

  const historyRef = useRef(history);
  historyRef.current = history;

  const recordHistory = useCallback(() => {
    if (applyingHistory.current) return;
    setHistory((h) => pushSnapshot(h, snapshotRef.current));
  }, []);

  const recordDraftHistory = useCallback(() => {
    if (applyingHistory.current) return;
    if (!typingBurst.current) {
      recordHistory();
      typingBurst.current = true;
    }
    if (typingBurstTimer.current != null) {
      window.clearTimeout(typingBurstTimer.current);
    }
    typingBurstTimer.current = window.setTimeout(() => {
      typingBurst.current = false;
      typingBurstTimer.current = null;
    }, 450);
  }, [recordHistory]);

  const recordStructureHistory = useCallback(() => {
    typingBurst.current = false;
    if (typingBurstTimer.current != null) {
      window.clearTimeout(typingBurstTimer.current);
      typingBurstTimer.current = null;
    }
    recordHistory();
  }, [recordHistory]);

  const applySnapshot = useCallback((snap: EditorSnapshot) => {
    applyingHistory.current = true;
    setDraftsZh(snap.draftsZh);
    setDraftsEn(snap.draftsEn);
    setDraftsSpeaker(snap.draftsSpeaker);
    setDraftsStatement(snap.draftsStatement);
    setStructureOps(snap.structureOps);
    setPendingLines(snap.pendingLines);
    pendingSeq.current = snap.pendingSeq;
    snapshotRef.current = snap;
    window.queueMicrotask(() => {
      applyingHistory.current = false;
    });
  }, []);

  const handleUndo = useCallback(() => {
    const result = undoHistory(historyRef.current, snapshotRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistory(result.history);
    applySnapshot(result.snapshot);
  }, [applySnapshot]);

  const handleRedo = useCallback(() => {
    const result = redoHistory(historyRef.current, snapshotRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistory(result.history);
    applySnapshot(result.snapshot);
  }, [applySnapshot]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    if (rightPaneRef.current) {
      rightPaneRef.current.scrollTop = 0;
    }
  }, [selectedFile]);

  useEffect(() => {
    try {
      const h = Number(window.localStorage.getItem(GRAPH_HEIGHT_KEY));
      if (Number.isFinite(h) && h >= GRAPH_HEIGHT_MIN) {
        setGraphHeight(h);
      }
      const collapsed = window.localStorage.getItem(GRAPH_COLLAPSED_KEY);
      if (collapsed === "1") setGraphCollapsed(true);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRAPH_HEIGHT_KEY, String(graphHeight));
    } catch {
      // ignore
    }
  }, [graphHeight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GRAPH_COLLAPSED_KEY,
        graphCollapsed ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [graphCollapsed]);

  const clampGraphHeight = useCallback((raw: number) => {
    const pane = leftPaneRef.current?.clientHeight ?? window.innerHeight;
    const max = Math.max(
      GRAPH_HEIGHT_MIN + 40,
      Math.floor(pane * GRAPH_HEIGHT_MAX_RATIO),
    );
    return Math.min(max, Math.max(GRAPH_HEIGHT_MIN, Math.round(raw)));
  }, []);

  const onSplitterPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (graphCollapsed) return;
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startHeight: graphHeight };
    },
    [graphCollapsed, graphHeight],
  );

  const onSplitterPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      setGraphHeight(clampGraphHeight(dragRef.current.startHeight + delta));
    },
    [clampGraphHeight],
  );

  const onSplitterPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [],
  );

  const showToast = useCallback((kind: "ok" | "error", message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const deletedIds = useMemo(() => {
    const set = new Set<string>();
    for (const op of structureOps) {
      if (op.op === "delete") set.add(op.id);
    }
    return set;
  }, [structureOps]);

  const insertOps = useMemo(
    () =>
      structureOps.filter(
        (o): o is Extract<StagedStructureOp, { op: "insert" }> =>
          o.op === "insert",
      ),
    [structureOps],
  );

  const swapOps = useMemo(
    () =>
      structureOps.filter(
        (o): o is Extract<StagedStructureOp, { op: "swap" }> =>
          o.op === "swap",
      ),
    [structureOps],
  );

  const editorLines = useMemo(() => {
    if (!index) return [] as DialogueLine[];
    if (!selectedFile) return index.lines;
    const visible = applySwapOps(
      buildVisibleLines(
        index.lines,
        selectedFile,
        deletedIds,
        pendingLines,
        insertOps,
      ),
      swapOps.filter((s) => s.file === selectedFile),
    );
    // Keep other files' lines for LineEditor filter (it filters by selectedFile)
    const others = index.lines.filter(
      (l) => l.file !== selectedFile && !deletedIds.has(l.id),
    );
    return [...others, ...visible];
  }, [index, selectedFile, deletedIds, pendingLines, insertOps, swapOps]);

  const dirtyCount = useMemo(() => {
    if (!index) return 0;
    let n = structureOps.length;
    const allLines = [
      ...index.lines.filter((l) => !deletedIds.has(l.id)),
      ...Object.values(pendingLines).filter((l) => !deletedIds.has(l.id)),
    ];
    for (const line of allLines) {
      const baseText = isPendingId(line.id) ? line.text : line.text;
      const zh = draftsZh[line.id];
      if (zh !== undefined && zh !== baseText) n += 1;
      else if (isPendingId(line.id) && (zh ?? line.text) === line.text) {
        // pending empty line still counted via structureOps insert
      }
      const en = draftsEn[line.id];
      if (
        en !== undefined &&
        line.tlFile &&
        en !== (line.textEn ?? "")
      ) {
        n += 1;
      }
      if (
        Object.prototype.hasOwnProperty.call(draftsSpeaker, line.id) &&
        (draftsSpeaker[line.id] ?? null) !== line.speaker
      ) {
        n += 1;
      }
      if (
        line.kind === "show" ||
        line.kind === "hide" ||
        line.kind === "scene" ||
        line.kind === "play_music" ||
        line.kind === "play_sound" ||
        line.kind === "play_ambient"
      ) {
        const base = statementBase(line);
        const st = draftsStatement[line.id];
        if (st !== undefined && st !== base) n += 1;
      }
    }
    return n;
  }, [
    draftsZh,
    draftsEn,
    draftsSpeaker,
    draftsStatement,
    index,
    structureOps,
    pendingLines,
    deletedIds,
  ]);

  const lineCounts = useMemo(() => {
    const map: Record<string, number> = {};
    if (!index) return map;
    for (const file of index.files) {
      const visible = applySwapOps(
        buildVisibleLines(
          index.lines,
          file,
          deletedIds,
          pendingLines,
          insertOps,
        ),
        swapOps.filter((s) => s.file === file),
      );
      map[file] = visible.length;
    }
    return map;
  }, [index, deletedIds, pendingLines, insertOps, swapOps]);

  const clearDrafts = useCallback(() => {
    setDraftsZh({});
    setDraftsEn({});
    setDraftsSpeaker({});
    setDraftsStatement({});
    setStructureOps([]);
    setPendingLines({});
    setHistory(emptyHistory());
    typingBurst.current = false;
    pendingSeq.current = 0;
  }, []);

  const confirmDiscardIfNeeded = useCallback(() => {
    if (dirtyCount === 0) return true;
    return window.confirm(`有 ${dirtyCount} 处未保存修改，确定丢弃吗？`);
  }, [dirtyCount]);

  const applyIndex = useCallback(
    (next: ProjectIndex, keepFile?: string | null) => {
      setIndex(next);
      clearDrafts();
      const preferred =
        keepFile && next.files.includes(keepFile)
          ? keepFile
          : defaultFileForIndex(next);
      setSelectedFile(preferred);
    },
    [clearDrafts],
  );

  const runScan = useCallback(
    async (
      keepFile?: string | null,
      opts?: { toastMessage?: string | null },
    ) => {
      setBusy(true);
      try {
        const res = await fetch("/api/scan");
        const data = (await res.json()) as {
          session?: ProjectSession;
          index?: ProjectIndex;
          error?: string;
        };
        if (!res.ok || !data.index) {
          showToast("error", data.error || "扫描失败");
          return null;
        }
        if (data.session) setSession(data.session);
        const preserve =
          keepFile === undefined ? selectedFile : keepFile;
        applyIndex(data.index, preserve);
        if (opts?.toastMessage !== null) {
          showToast(
            "ok",
            opts?.toastMessage ??
              `已扫描 ${data.index.files.length} 文件 · ${data.index.lines.length} 行 · 英对照 ${data.index.tlPairedCount} · 可达 ${data.index.reachable.length} 节点`,
          );
        }
        return data.index;
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "扫描失败");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applyIndex, selectedFile, showToast],
  );

  useEffect(() => {
    async function boot() {
      try {
        const res = await fetch("/api/project/current");
        const data = (await res.json()) as { session: ProjectSession | null };
        if (data.session) {
          setSession(data.session);
          pushRecent(data.session);
          const scanRes = await fetch("/api/scan");
          const scanData = (await scanRes.json()) as {
            index?: ProjectIndex;
          };
          if (scanRes.ok && scanData.index) {
            applyIndex(scanData.index);
          }
        }
      } catch {
        // ignore boot errors
      } finally {
        setBootstrapped(true);
      }
    }
    void boot();
  }, [applyIndex]);

  function onDraftZhChange(id: string, text: string) {
    recordDraftHistory();
    setDraftsZh((prev) => ({ ...prev, [id]: text }));
  }

  function onDraftEnChange(id: string, text: string) {
    recordDraftHistory();
    setDraftsEn((prev) => ({ ...prev, [id]: text }));
  }

  function onDraftSpeakerChange(id: string, speaker: string | null) {
    recordDraftHistory();
    setDraftsSpeaker((prev) => ({ ...prev, [id]: speaker }));
  }

  function onDraftStatementChange(id: string, statement: string) {
    recordDraftHistory();
    setDraftsStatement((prev) => ({ ...prev, [id]: statement }));
  }

  function selectFile(file: string) {
    if (file === selectedFile) return;
    if (!confirmDiscardIfNeeded()) return;
    setSelectedFile(file);
    if (dirtyCount > 0) clearDrafts();
  }

  async function handleSave() {
    if (!index || dirtyCount === 0) return;

    const surviving = [
      ...index.lines.filter((l) => !deletedIds.has(l.id)),
      ...Object.values(pendingLines).filter((l) => !deletedIds.has(l.id)),
    ];

    const contents: {
      id: string;
      file: string;
      text: string;
      applySpeaker?: boolean;
      speaker?: string | null;
      mode?: "say" | "statement";
    }[] = [];
    const tlEdits: {
      file: string;
      line: number;
      text: string;
      allowTl?: boolean;
    }[] = [];

    for (const line of surviving) {
      if (isStatementKind(line.kind)) {
        const base = statementBase(line);
        const st = draftsStatement[line.id] ?? base;
        if (isPendingId(line.id) || st !== base) {
          contents.push({
            id: line.id,
            file: line.file,
            text: st,
            mode: "statement",
          });
        }
        continue;
      }

      const zh = draftsZh[line.id] ?? line.text;
      const zhDirty = zh !== line.text;
      const speakerDirty =
        Object.prototype.hasOwnProperty.call(draftsSpeaker, line.id) &&
        (draftsSpeaker[line.id] ?? null) !== line.speaker;
      const speaker = Object.prototype.hasOwnProperty.call(
        draftsSpeaker,
        line.id,
      )
        ? (draftsSpeaker[line.id] ?? null)
        : line.speaker;

      if (isPendingId(line.id) && line.kind === "say") {
        contents.push({
          id: line.id,
          file: line.file,
          text: zh,
          applySpeaker: true,
          speaker,
        });
      } else if (line.kind === "say" && (zhDirty || speakerDirty)) {
        contents.push({
          id: line.id,
          file: line.file,
          text: zh,
          applySpeaker: speakerDirty,
          speaker: speakerDirty ? speaker : undefined,
        });
      } else if (zhDirty) {
        contents.push({ id: line.id, file: line.file, text: zh });
      }

      if (
        zhDirty &&
        !isPendingId(line.id) &&
        line.tlFile &&
        line.tlCommentLine != null
      ) {
        tlEdits.push({
          file: line.tlFile,
          line: line.tlCommentLine,
          text: zh,
          allowTl: true,
        });
      }

      const en = draftsEn[line.id] ?? line.textEn ?? "";
      const enDirty =
        line.tlFile != null &&
        draftsEn[line.id] !== undefined &&
        en !== (line.textEn ?? "");
      if (enDirty && line.tlFile && line.tlLine != null) {
        tlEdits.push({
          file: line.tlFile,
          line: line.tlLine,
          text: en,
          allowTl: true,
        });
      }
    }

    // Collapse: drop insert ops whose id was later deleted
    const finalOps = structureOps.filter((op) => {
      if (op.op === "insert" && deletedIds.has(op.id)) return false;
      if (op.op === "delete" && isPendingId(op.id)) return false;
      if (op.op === "swap") {
        if (deletedIds.has(op.a) || deletedIds.has(op.b)) return false;
      }
      return true;
    });

    const affectedFiles = new Set<string>();
    for (const op of finalOps) affectedFiles.add(op.file);
    for (const c of contents) affectedFiles.add(c.file);

    const anchors = index.lines
      .filter((l) => affectedFiles.has(l.file))
      .map((l) => ({ id: l.id, file: l.file, line: l.line }));

    if (
      finalOps.length === 0 &&
      contents.length === 0 &&
      tlEdits.length === 0
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/write", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchors,
          structureOps: finalOps,
          contents,
          tlEdits,
        }),
      });
      const data = (await res.json()) as {
        updatedFiles?: string[];
        errors?: string[];
        error?: string;
      };
      if (!res.ok && !(data.updatedFiles && data.updatedFiles.length)) {
        showToast("error", data.error || data.errors?.join("; ") || "保存失败");
        return;
      }
      if (data.errors?.length) {
        showToast("error", `部分失败：${data.errors.slice(0, 3).join("; ")}`);
      } else {
        const n =
          finalOps.length + contents.length + tlEdits.length;
        showToast(
          "ok",
          `已写入 ${data.updatedFiles?.length ?? 0} 个文件（${n} 处）· 请核对英文`,
        );
      }
      await runScan(selectedFile);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function handleRescan() {
    if (!confirmDiscardIfNeeded()) return;
    void runScan();
  }

  function handleDeleteLine(line: DialogueLine) {
    const zh = draftsZh[line.id] ?? line.text;
    const label =
      line.kind === "py_call"
        ? `$${line.callName ?? "?"}(${(line.callArgs ?? "").slice(0, 24)})`
        : line.kind === "play_sound" ||
            line.kind === "play_music" ||
            line.kind === "play_ambient"
          ? `${line.kind.replace("play_", "play ")} ${zh}`
          : line.kind === "if" || line.kind === "elif" || line.kind === "else"
            ? `${line.kind} ${zh}`.trim()
            : line.kind === "scene" ||
                line.kind === "show" ||
                line.kind === "hide"
              ? `${line.kind} ${zh}`
              : zh;
    const preview = label.length > 48 ? `${label.slice(0, 48)}…` : label;
    if (
      !window.confirm(
        `确定删除这一行？（暂存，点保存后才写入文件）\n「${preview || "（空）"}」`,
      )
    ) {
      return;
    }

    if (isPendingId(line.id)) {
      recordStructureHistory();
      const descendants = collectInsertDescendants(line.id, structureOps);
      const removeIds = new Set([line.id, ...descendants]);
      setStructureOps((prev) =>
        prev.filter((op) => {
          if (op.op === "insert" && removeIds.has(op.id)) return false;
          if (op.op === "delete" && removeIds.has(op.id)) return false;
          if (op.op === "swap" && (removeIds.has(op.a) || removeIds.has(op.b))) {
            return false;
          }
          return true;
        }),
      );
      setPendingLines((prev) => {
        const next = { ...prev };
        for (const id of removeIds) delete next[id];
        return next;
      });
      setDraftsZh((prev) => {
        const next = { ...prev };
        for (const id of removeIds) delete next[id];
        return next;
      });
      setDraftsSpeaker((prev) => {
        const next = { ...prev };
        for (const id of removeIds) delete next[id];
        return next;
      });
      setDraftsStatement((prev) => {
        const next = { ...prev };
        for (const id of removeIds) delete next[id];
        return next;
      });
      return;
    }

    recordStructureHistory();
    const descendants = collectInsertDescendants(line.id, structureOps);
    setStructureOps((prev) => [
      ...prev.filter(
        (op) =>
          !(op.op === "insert" && descendants.has(op.id)) &&
          !(
            op.op === "swap" &&
            (op.a === line.id ||
              op.b === line.id ||
              descendants.has(op.a) ||
              descendants.has(op.b))
          ),
      ),
      { op: "delete", id: line.id, file: line.file },
    ]);
    setPendingLines((prev) => {
      const next = { ...prev };
      for (const id of descendants) delete next[id];
      return next;
    });
  }

  function handleInsertLine(
    line: DialogueLine,
    speaker: string | null,
  ): string | null {
    if (!line.allowInsertAfter && !isPendingId(line.id)) {
      showToast("error", "此处不可新增（menu 块内等）");
      return null;
    }

    recordStructureHistory();
    pendingSeq.current += 1;
    const id = `pending:${pendingSeq.current}`;
    const pending: DialogueLine = {
      id,
      file: line.file,
      line: 0,
      speaker,
      text: "",
      kind: "say",
      label: line.label,
      branchDepth: line.branchDepth,
      allowInsertAfter: true,
      callName: null,
      callArgs: null,
      textEn: null,
      tlFile: null,
      tlLine: null,
      tlCommentLine: null,
      tlCommentZh: null,
      tlStale: false,
    };

    setPendingLines((prev) => ({ ...prev, [id]: pending }));
    setStructureOps((prev) => [
      ...prev,
      {
        op: "insert",
        id,
        file: line.file,
        afterId: line.id,
        insertKind: "say",
        speaker,
        text: "",
      },
    ]);
    setDraftsSpeaker((prev) => ({ ...prev, [id]: speaker }));
    setDraftsZh((prev) => ({ ...prev, [id]: "" }));
    return id;
  }

  function canAnchorMarkerInsert(line: DialogueLine): boolean {
    if (line.kind === "menu_caption" || line.kind === "menu_choice") {
      return false;
    }
    return true;
  }

  function handleMoveLine(line: DialogueLine, direction: "up" | "down") {
    if (!selectedFile || line.file !== selectedFile) return;
    const visible = applySwapOps(
      buildVisibleLines(
        index?.lines ?? [],
        selectedFile,
        deletedIds,
        pendingLines,
        insertOps,
      ),
      swapOps.filter((s) => s.file === selectedFile),
    );
    const idx = visible.findIndex((l) => l.id === line.id);
    if (idx < 0) return;
    const otherIdx = direction === "up" ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= visible.length) return;
    const other = visible[otherIdx];
    recordStructureHistory();
    setStructureOps((prev) => [
      ...prev,
      { op: "swap", file: line.file, a: line.id, b: other.id },
    ]);
  }

  function handleInsertMarker(
    after: DialogueLine,
    kind:
      | "show"
      | "hide"
      | "scene"
      | "play_music"
      | "play_sound"
      | "play_ambient",
    statement: string,
  ): string | null {
    if (!canAnchorMarkerInsert(after)) {
      showToast("error", "菜单选项处不可插入该指令");
      return null;
    }

    recordStructureHistory();
    pendingSeq.current += 1;
    const id = `pending:${pendingSeq.current}`;
    const arg = statement
      .replace(/^(show|hide|scene)\s+/, "")
      .replace(/^play\s+(music|sound|ambient)\s+/, "")
      .trim();
    const pending: DialogueLine = {
      id,
      file: after.file,
      line: 0,
      speaker: null,
      text: arg,
      kind,
      label: after.label,
      branchDepth: after.branchDepth,
      allowInsertAfter: false,
      callName: null,
      callArgs: null,
      textEn: null,
      tlFile: null,
      tlLine: null,
      tlCommentLine: null,
      tlCommentZh: null,
      tlStale: false,
    };

    setPendingLines((prev) => ({ ...prev, [id]: pending }));
    setStructureOps((prev) => [
      ...prev,
      {
        op: "insert",
        id,
        file: after.file,
        afterId: after.id,
        insertKind: kind,
        speaker: null,
        text: arg,
        statement,
      },
    ]);
    setDraftsStatement((prev) => ({ ...prev, [id]: statement }));
    return id;
  }

  function handleOpenPicker() {
    if (!confirmDiscardIfNeeded()) return;
    setPickerOpen(true);
  }

  function handleOpened(next: ProjectSession) {
    setSession(next);
    setIndex(null);
    clearDrafts();
    setSelectedFile(null);
    void runScan(null);
  }

  if (!bootstrapped) {
    return (
      <div className="app-shell">
        <main className="main-full">
          <p className="muted">加载中…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">Ren&apos;Py Work</div>
          <div className="project-name">
            {session
              ? `${session.displayName} · ${session.gameRoot}`
              : "未打开项目"}
          </div>
        </div>
        <AppNav />
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={handleOpenPicker}>
            打开项目
          </button>
          <button
            type="button"
            className="btn"
            disabled={!session || busy}
            onClick={handleRescan}
          >
            重新扫描
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!session || busy || dirtyCount === 0}
            onClick={() => void handleSave()}
          >
            保存{dirtyCount > 0 ? `（${dirtyCount}）` : ""}
          </button>
        </div>
      </header>

      {!session ? (
        <main className="main-full">
          <div className="empty-state">
            <h1>本地 Ren&apos;Py 文本编辑器</h1>
            <p>
              选择工程后查看从 start 展开的分支关系图；用左侧文件列表打开对话编辑，点保存才写回
              .rpy。分支图可收起或拖动分隔条调整高度。
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => setPickerOpen(true)}
            >
              打开项目
            </button>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="left-pane" ref={leftPaneRef}>
            <section
              className={`graph-section${graphCollapsed ? " collapsed" : ""}`}
              style={
                graphCollapsed
                  ? undefined
                  : { height: graphHeight, maxHeight: graphHeight }
              }
            >
              <div className="graph-toolbar">
                <span className="graph-toolbar-label">分支图</span>
                <div className="graph-toolbar-actions">
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setGraphCollapsed((v) => !v)}
                    aria-expanded={!graphCollapsed}
                    title={graphCollapsed ? "展开分支图" : "收起分支图"}
                  >
                    {graphCollapsed ? "展开" : "收起"}
                  </button>
                </div>
              </div>
              {!graphCollapsed && (
                <div className="graph-body">
                  {index ? (
                    <BranchGraph
                      index={index}
                      onSelectLabelFile={selectFile}
                    />
                  ) : (
                    <p className="muted graph-empty">扫描中…</p>
                  )}
                </div>
              )}
            </section>
            {!graphCollapsed && (
              <button
                type="button"
                className="pane-splitter"
                aria-label="拖动调整分支图高度"
                onPointerDown={onSplitterPointerDown}
                onPointerMove={onSplitterPointerMove}
                onPointerUp={onSplitterPointerUp}
                onPointerCancel={onSplitterPointerUp}
              />
            )}
            <section className="files-section">
              <FileList
                files={index?.files ?? []}
                selectedFile={selectedFile}
                onSelect={selectFile}
                lineCounts={lineCounts}
              />
            </section>
          </aside>
          <main className="right-pane" ref={rightPaneRef}>
            <div className="right-toolbar muted">
              {index
                ? `${index.files.length} 文件 · ${index.lines.length} 行 · 可英译 ${index.tlPairedCount}`
                : "尚未扫描"}
              {dirtyCount > 0 ? ` · ${dirtyCount} 未保存` : ""}
            </div>
            <LineEditor
              lines={editorLines}
              characters={index?.characters ?? []}
              sprites={index?.sprites ?? []}
              transforms={index?.transforms ?? []}
              transitions={index?.transitions ?? []}
              backgrounds={index?.backgrounds ?? []}
              bgTransforms={index?.bgTransforms ?? []}
              bgm={index?.bgm ?? []}
              ambient={index?.ambient ?? []}
              sfx={index?.sfx ?? []}
              fadeins={index?.fadeins ?? []}
              draftsZh={draftsZh}
              draftsEn={draftsEn}
              draftsSpeaker={draftsSpeaker}
              draftsStatement={draftsStatement}
              selectedFile={selectedFile}
              busy={busy}
              onDraftZhChange={onDraftZhChange}
              onDraftEnChange={onDraftEnChange}
              onDraftSpeakerChange={onDraftSpeakerChange}
              onDraftStatementChange={onDraftStatementChange}
              onDeleteLine={handleDeleteLine}
              onInsertLine={handleInsertLine}
              onInsertMarker={handleInsertMarker}
              onMoveLine={handleMoveLine}
              canUndo={history.past.length > 0}
              canRedo={history.future.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
          </main>
        </div>
      )}

      <ProjectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onOpened={handleOpened}
      />

      {toast && (
        <div
          className={`status-toast${toast.kind === "error" ? " error" : ""}`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
