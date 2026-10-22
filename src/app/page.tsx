"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineEditor } from "@/components/LineEditor";
import { ProjectPicker, pushRecent } from "@/components/ProjectPicker";
import type { DialogueLine, ProjectIndex, ProjectSession } from "@/lib/types";

type Toast = { kind: "ok" | "error"; message: string } | null;

export default function HomePage() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const showToast = useCallback((kind: "ok" | "error", message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const dirtyCount = useMemo(() => {
    if (!index) return 0;
    let n = 0;
    for (const line of index.lines) {
      const draft = drafts[line.id];
      if (draft !== undefined && draft !== line.text) n += 1;
    }
    return n;
  }, [drafts, index]);

  const confirmDiscardIfNeeded = useCallback(() => {
    if (dirtyCount === 0) return true;
    return window.confirm(`有 ${dirtyCount} 处未保存修改，确定丢弃吗？`);
  }, [dirtyCount]);

  const runScan = useCallback(async () => {
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
      setIndex(data.index);
      setDrafts({});
      showToast(
        "ok",
        `已扫描 ${data.index.files.length} 个文件，${data.index.lines.length} 行对话`,
      );
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  }, [showToast]);

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
            error?: string;
          };
          if (scanRes.ok && scanData.index) {
            setIndex(scanData.index);
          }
        }
      } catch {
        // ignore boot errors
      } finally {
        setBootstrapped(true);
      }
    }
    void boot();
  }, []);

  function onDraftChange(id: string, text: string) {
    setDrafts((prev) => ({ ...prev, [id]: text }));
  }

  async function handleSave() {
    if (!index || dirtyCount === 0) return;
    const edits: { file: string; line: number; text: string }[] = [];
    const lineById = new Map<string, DialogueLine>(
      index.lines.map((l) => [l.id, l]),
    );

    for (const [id, text] of Object.entries(drafts)) {
      const line = lineById.get(id);
      if (!line) continue;
      if (text === line.text) continue;
      edits.push({ file: line.file, line: line.line, text });
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
        showToast(
          "error",
          `部分失败：${data.errors.slice(0, 3).join("; ")}`,
        );
      } else {
        showToast(
          "ok",
          `已写入 ${data.updatedFiles?.length ?? 0} 个文件（${edits.length} 行）`,
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
    setDrafts({});
    setFileFilter("");
    void runScan();
  }

  if (!bootstrapped) {
    return (
      <div className="app-shell">
        <main className="main">
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

      <main className="main">
        {!session ? (
          <div className="empty-state">
            <h1>本地 Ren&apos;Py 文本编辑器</h1>
            <p>选择任意含 game/ 的工程目录，扫描对话并用 textarea 编辑；点保存才写回 .rpy。</p>
            <button type="button" className="btn primary" onClick={() => setPickerOpen(true)}>
              打开项目
            </button>
          </div>
        ) : (
          <>
            <div className="toolbar-row">
              <input
                className="filter-input"
                placeholder="按文件名过滤…"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
              />
              <span className="stats">
                {index
                  ? `${index.files.length} 文件 · ${index.lines.length} 行`
                  : "尚未扫描"}
                {dirtyCount > 0 ? ` · ${dirtyCount} 未保存` : ""}
              </span>
            </div>
            <LineEditor
              lines={index?.lines ?? []}
              drafts={drafts}
              fileFilter={fileFilter}
              onDraftChange={onDraftChange}
            />
          </>
        )}
      </main>

      <ProjectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onOpened={handleOpened}
      />

      {toast && (
        <div className={`status-toast${toast.kind === "error" ? " error" : ""}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
