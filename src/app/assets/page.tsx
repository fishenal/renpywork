"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { AssetBrowser } from "@/components/AssetBrowser";
import { ProjectPicker, pushRecent } from "@/components/ProjectPicker";
import type { AssetIndex } from "@/lib/parse/assets";
import type { ProjectSession } from "@/lib/types";

type Toast = { kind: "ok" | "error"; message: string } | null;

export default function AssetsPage() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [index, setIndex] = useState<AssetIndex | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const showToast = useCallback((kind: "ok" | "error", message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const loadAssets = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/assets");
      const data = (await res.json()) as {
        session?: ProjectSession;
        index?: AssetIndex;
        error?: string;
      };
      if (!res.ok || !data.index) {
        showToast("error", data.error || "扫描失败");
        return;
      }
      if (data.session) setSession(data.session);
      setIndex(data.index);
      const n = data.index.items.length;
      showToast("ok", `已扫描 ${n} 项资源`);
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
          await loadAssets();
        }
      } catch {
        // ignore
      } finally {
        setBootstrapped(true);
      }
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpened(next: ProjectSession) {
    setSession(next);
    setIndex(null);
    await loadAssets();
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
          <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
            打开项目
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!session || busy}
            onClick={() => void loadAssets()}
          >
            重新扫描
          </button>
        </div>
      </header>

      {!session ? (
        <main className="main-full">
          <div className="empty-state">
            <h1>资源管理器</h1>
            <p>
              打开 Ren&apos;Py 工程后，可浏览角色、立绘、场景、BGM / 音效等脚本定义与文件预览（只读）。
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
        <main className="assets-main">
          {index ? (
            <AssetBrowser index={index} />
          ) : (
            <p className="muted" style={{ padding: "1.5rem" }}>
              {busy ? "扫描中…" : "点击「重新扫描」加载资源"}
            </p>
          )}
        </main>
      )}

      <ProjectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onOpened={(s) => void handleOpened(s)}
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
