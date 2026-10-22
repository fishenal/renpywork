"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectSession } from "@/lib/types";

const RECENT_KEY = "renpywork.recentProjects";
const MAX_RECENT = 8;

type FsListResponse = {
  path: string;
  parent: string | null;
  entries: {
    name: string;
    path: string;
    isDirectory: boolean;
    looksLikeRenpy: boolean;
  }[];
  error?: string;
};

function loadRecent(): ProjectSession[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushRecent(session: ProjectSession) {
  const prev = loadRecent().filter((s) => s.gameRoot !== session.gameRoot);
  const next = [session, ...prev].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

type Props = {
  open: boolean;
  onClose: () => void;
  onOpened: (session: ProjectSession) => void;
};

export function ProjectPicker({ open, onClose, onOpened }: Props) {
  const [cwd, setCwd] = useState<string>("");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsListResponse["entries"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [recent, setRecent] = useState<ProjectSession[]>([]);
  const [opening, setOpening] = useState(false);

  const browse = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(target)}`);
      const data = (await res.json()) as FsListResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || "无法列出目录");
        return;
      }
      setCwd(data.path);
      setParent(data.parent);
      setEntries(data.entries);
      setPathInput(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
    void browse(pathInput || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function importPath(root: string) {
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root }),
      });
      const data = (await res.json()) as { session?: ProjectSession; error?: string };
      if (!res.ok || !data.session) {
        setError(data.error || "导入失败");
        return;
      }
      pushRecent(data.session);
      setRecent(loadRecent());
      onOpened(data.session);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setOpening(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal-header">
          <h2>打开 Ren&apos;Py 项目</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        {recent.length > 0 && (
          <section className="recent-block">
            <h3>最近打开</h3>
            <ul className="recent-list">
              {recent.map((s) => (
                <li key={s.gameRoot}>
                  <button
                    type="button"
                    className="linkish"
                    disabled={opening}
                    onClick={() => void importPath(s.root)}
                    title={s.gameRoot}
                  >
                    <strong>{s.displayName}</strong>
                    <span className="muted">{s.gameRoot}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="path-row">
          <input
            className="path-input"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void browse(pathInput);
            }}
            placeholder="绝对路径"
          />
          <button type="button" className="btn" disabled={loading} onClick={() => void browse(pathInput)}>
            前往
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={opening || !pathInput}
            onClick={() => void importPath(pathInput || cwd)}
          >
            导入此路径
          </button>
        </div>

        <div className="browser-toolbar">
          <button
            type="button"
            className="btn ghost"
            disabled={!parent || loading}
            onClick={() => parent && void browse(parent)}
          >
            上级
          </button>
          <span className="cwd muted">{cwd || "…"}</span>
        </div>

        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">加载中…</p>}

        <ul className="dir-list">
          {entries.map((entry) => (
            <li key={entry.path} className={entry.looksLikeRenpy ? "renpy-hit" : undefined}>
              <button
                type="button"
                className="dir-item"
                onDoubleClick={() => void browse(entry.path)}
                onClick={() => setPathInput(entry.path)}
              >
                <span className="dir-name">{entry.name}/</span>
                {entry.looksLikeRenpy && <span className="badge">Ren&apos;Py?</span>}
              </button>
              <button
                type="button"
                className="btn small"
                disabled={opening}
                onClick={() => void importPath(entry.path)}
              >
                导入
              </button>
            </li>
          ))}
          {!loading && entries.length === 0 && (
            <li className="muted">此目录下没有子文件夹</li>
          )}
        </ul>

        <p className="hint muted">
          单击选中路径，双击进入子目录。可导入工程根（含 game/）或直接导入 game/。
        </p>
      </div>
    </div>
  );
}

export { loadRecent, pushRecent };
