"use client";

import { useMemo, useState } from "react";
import type { AssetIndex, AssetItem, AssetKind } from "@/lib/parse/assets";

const KIND_LABEL: Record<AssetKind, string> = {
  character: "角色 Character",
  sprite: "立绘",
  bg: "场景 / 背景",
  bgm: "BGM",
  sfx: "环境音 SFX",
  snd: "音效",
  other: "其他",
};

const KIND_TABS: Array<AssetKind | "all"> = [
  "all",
  "character",
  "sprite",
  "bg",
  "bgm",
  "sfx",
  "snd",
  "other",
];

function formatSize(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isImagePath(p: string | null): boolean {
  if (!p) return false;
  return /\.(webp|png|jpe?g|gif)$/i.test(p);
}

function isAudioPath(p: string | null): boolean {
  if (!p) return false;
  return /\.(mp3|ogg|wav|webm)$/i.test(p);
}

type Props = {
  index: AssetIndex;
};

export function AssetBrowser({ index }: Props) {
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return index.items.filter((it) => {
      if (kind !== "all" && it.kind !== kind) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.path?.toLowerCase().includes(q) ?? false) ||
        (it.note?.toLowerCase().includes(q) ?? false) ||
        it.defFile.toLowerCase().includes(q)
      );
    });
  }, [index.items, kind, query]);

  const selected: AssetItem | null =
    filtered.find((i) => i.id === selectedId) ??
    index.items.find((i) => i.id === selectedId) ??
    null;

  return (
    <div className="asset-browser">
      <div className="asset-toolbar">
        <div className="asset-tabs">
          {KIND_TABS.map((k) => {
            const count =
              k === "all"
                ? index.items.length
                : index.counts[k];
            const label = k === "all" ? "全部" : KIND_LABEL[k];
            return (
              <button
                key={k}
                type="button"
                className={`asset-tab${kind === k ? " active" : ""}`}
                onClick={() => setKind(k)}
              >
                {label}
                <span className="tab-count">{count}</span>
              </button>
            );
          })}
        </div>
        <input
          className="filter-input asset-search"
          placeholder="搜索名称 / 路径 / 备注…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="asset-split">
        <ul className="asset-list">
          {filtered.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className={`asset-row${selected?.id === it.id ? " active" : ""}`}
                onClick={() => setSelectedId(it.id)}
              >
                <span className="asset-kind-pill">{KIND_LABEL[it.kind]}</span>
                <span className="asset-name">{it.name}</span>
                <span className="asset-path muted">
                  {it.path ?? it.note ?? "—"}
                </span>
                {!it.exists && it.path && (
                  <span className="badge missing-badge">缺失</span>
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="muted asset-empty">没有匹配的资源</li>
          )}
        </ul>

        <aside className="asset-detail">
          {!selected ? (
            <p className="empty-hint">从左侧选择一项资源查看详情</p>
          ) : (
            <div className="asset-detail-body">
              <h2 className="asset-detail-title">{selected.name}</h2>
              <dl className="asset-meta">
                <div>
                  <dt>类型</dt>
                  <dd>{KIND_LABEL[selected.kind]}</dd>
                </div>
                <div>
                  <dt>脚本名</dt>
                  <dd>
                    <code>{selected.name}</code>
                  </dd>
                </div>
                {selected.note && (
                  <div>
                    <dt>
                      {selected.kind === "character" ? "显示名" : "备注"}
                    </dt>
                    <dd>{selected.note}</dd>
                  </div>
                )}
                <div>
                  <dt>文件路径</dt>
                  <dd>
                    {selected.path ? (
                      <code>{selected.path}</code>
                    ) : (
                      <span className="muted">（无文件，仅脚本定义）</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>定义位置</dt>
                  <dd>
                    <code>
                      {selected.defFile}:{selected.defLine}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>磁盘</dt>
                  <dd>
                    {selected.path
                      ? selected.exists
                        ? `存在 · ${formatSize(selected.size)}`
                        : "文件缺失"
                      : "—"}
                  </dd>
                </div>
              </dl>

              {selected.path && selected.exists && isImagePath(selected.path) && (
                <div className="asset-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/media?path=${encodeURIComponent(selected.path)}`}
                    alt={selected.name}
                  />
                </div>
              )}

              {selected.path && selected.exists && isAudioPath(selected.path) && (
                <div className="asset-preview audio">
                  <audio
                    key={selected.path}
                    controls
                    src={`/api/media?path=${encodeURIComponent(selected.path)}`}
                  />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
