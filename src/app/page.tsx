"use client";

import {
  useCallback,
  useEffect,
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
import type { ProjectIndex, ProjectSession } from "@/lib/types";

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

export default function HomePage() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [draftsZh, setDraftsZh] = useState<Record<string, string>>({});
  const [draftsEn, setDraftsEn] = useState<Record<string, string>>({});
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

  const dirtyCount = useMemo(() => {
    if (!index) return 0;
    let n = 0;
    for (const line of index.lines) {
      const zh = draftsZh[line.id];
      if (zh !== undefined && zh !== line.text) n += 1;
      const en = draftsEn[line.id];
      if (
        en !== undefined &&
        line.tlFile &&
        en !== (line.textEn ?? "")
      ) {
        n += 1;
      }
    }
    return n;
  }, [draftsZh, draftsEn, index]);

  const lineCounts = useMemo(() => {
    const map: Record<string, number> = {};
    if (!index) return map;
    for (const line of index.lines) {
      map[line.file] = (map[line.file] ?? 0) + 1;
    }
    return map;
  }, [index]);

  const confirmDiscardIfNeeded = useCallback(() => {
    if (dirtyCount === 0) return true;
    return window.confirm(`有 ${dirtyCount} 处未保存修改，确定丢弃吗？`);
  }, [dirtyCount]);

  const applyIndex = useCallback((next: ProjectIndex, keepFile?: string | null) => {
    setIndex(next);
    setDraftsZh({});
    setDraftsEn({});
    const preferred =
      keepFile && next.files.includes(keepFile)
        ? keepFile
        : defaultFileForIndex(next);
    setSelectedFile(preferred);
  }, []);

  const runScan = useCallback(
    async (keepFile?: string | null) => {
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
          return;
        }
        if (data.session) setSession(data.session);
        const preserve =
          keepFile === undefined ? selectedFile : keepFile;
        applyIndex(data.index, preserve);
        showToast(
          "ok",
          `已扫描 ${data.index.files.length} 文件 · ${data.index.lines.length} 行 · 英对照 ${data.index.tlPairedCount} · 可达 ${data.index.reachable.length} 节点`,
        );
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "扫描失败");
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
    setDraftsZh((prev) => ({ ...prev, [id]: text }));
  }

  function onDraftEnChange(id: string, text: string) {
    setDraftsEn((prev) => ({ ...prev, [id]: text }));
  }

  function selectFile(file: string) {
    if (file === selectedFile) return;
    if (!confirmDiscardIfNeeded()) return;
    setSelectedFile(file);
    if (dirtyCount > 0) {
      setDraftsZh({});
      setDraftsEn({});
    }
  }

  async function handleSave() {
    if (!index || dirtyCount === 0) return;
    const edits: {
      file: string;
      line: number;
      text: string;
      allowTl?: boolean;
    }[] = [];

    for (const line of index.lines) {
      const zh = draftsZh[line.id] ?? line.text;
      const zhDirty = zh !== line.text;
      const en = draftsEn[line.id] ?? line.textEn ?? "";
      const enDirty =
        line.tlFile != null &&
        draftsEn[line.id] !== undefined &&
        en !== (line.textEn ?? "");

      if (zhDirty) {
        edits.push({ file: line.file, line: line.line, text: zh });
        // Sync tl `#` comment or `old` string to new Chinese
        if (line.tlFile && line.tlCommentLine != null) {
          edits.push({
            file: line.tlFile,
            line: line.tlCommentLine,
            text: zh,
            allowTl: true,
          });
        }
      }

      if (enDirty && line.tlFile && line.tlLine != null) {
        edits.push({
          file: line.tlFile,
          line: line.tlLine,
          text: en,
          allowTl: true,
        });
      }
    }

    if (edits.length === 0) return;

    setBusy(true);
    try {
      const res = await fetch("/api/write", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
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
        showToast(
          "ok",
          `已写入 ${data.updatedFiles?.length ?? 0} 个文件（${edits.length} 处）· 请核对英文`,
        );
      }
      await runScan();
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

  function handleOpenPicker() {
    if (!confirmDiscardIfNeeded()) return;
    setPickerOpen(true);
  }

  function handleOpened(next: ProjectSession) {
    setSession(next);
    setIndex(null);
    setDraftsZh({});
    setDraftsEn({});
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
              lines={index?.lines ?? []}
              draftsZh={draftsZh}
              draftsEn={draftsEn}
              selectedFile={selectedFile}
              onDraftZhChange={onDraftZhChange}
              onDraftEnChange={onDraftEnChange}
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
