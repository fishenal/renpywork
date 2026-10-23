"use client";

import { useEffect, useState } from "react";
import type { DialogueLine, DialogueLineKind } from "@/lib/types";

type Props = {
  lines: DialogueLine[];
  draftsZh: Record<string, string>;
  draftsEn: Record<string, string>;
  selectedFile: string | null;
  onDraftZhChange: (id: string, text: string) => void;
  onDraftEnChange: (id: string, text: string) => void;
};

const BRANCH_KINDS = new Set<DialogueLineKind>(["if", "elif", "else"]);
const MEDIA_KINDS = new Set<DialogueLineKind>([
  "scene",
  "show",
  "hide",
  "play_music",
  "play_sound",
  "play_ambient",
]);

function isEditable(kind: DialogueLineKind): boolean {
  return kind === "say" || kind === "menu_caption";
}

function isPyCall(kind: DialogueLineKind): boolean {
  return kind === "py_call";
}

const MEDIA_META: Record<
  string,
  { symbol: string; label: string; prefix: string }
> = {
  scene: { symbol: "▣", label: "scene", prefix: "scene" },
  show: { symbol: "◇", label: "show", prefix: "show" },
  hide: { symbol: "◆", label: "hide", prefix: "hide" },
  play_music: { symbol: "♪", label: "BGM", prefix: "play music" },
  play_sound: { symbol: "♫", label: "SFX", prefix: "play sound" },
  play_ambient: { symbol: "〜", label: "ambient", prefix: "play ambient" },
};

export function LineEditor({
  lines,
  draftsZh,
  draftsEn,
  selectedFile,
  onDraftZhChange,
  onDraftEnChange,
}: Props) {
  const [openEn, setOpenEn] = useState<Record<string, true>>({});
  const [fetchMsg, setFetchMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    setOpenEn({});
    setFetchMsg({});
  }, [selectedFile]);

  if (!selectedFile) {
    return (
      <p className="empty-hint">请从左侧文件列表选择一个 .rpy 文件开始编辑。</p>
    );
  }

  const visible = lines.filter((l) => l.file === selectedFile);

  if (visible.length === 0) {
    return (
      <p className="empty-hint">
        <code>{selectedFile}</code> 中没有扫描到对话行。
      </p>
    );
  }

  const dialogueCount = visible.filter((l) => isEditable(l.kind)).length;
  const branchCount = visible.filter((l) => BRANCH_KINDS.has(l.kind)).length;
  const mediaCount = visible.filter((l) => MEDIA_KINDS.has(l.kind)).length;
  const callCount = visible.filter((l) => isPyCall(l.kind)).length;
  const paired = visible.filter((l) => l.tlFile && l.textEn != null).length;

  function fetchEn(line: DialogueLine, zh: string) {
    const ok =
      line.tlFile != null &&
      line.textEn != null &&
      (line.tlCommentZh == null || line.tlCommentZh === zh);

    if (ok) {
      setOpenEn((prev) => ({ ...prev, [line.id]: true }));
      setFetchMsg((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      return;
    }

    setOpenEn((prev) => {
      const next = { ...prev };
      delete next[line.id];
      return next;
    });
    setFetchMsg((prev) => ({
      ...prev,
      [line.id]:
        line.tlFile && line.tlCommentZh && line.tlCommentZh !== zh
          ? "中文已改动，与已配对译文不一致；保存后重新扫描，或手改英文"
          : "未找到与当前中文一致的英文（可能尚未翻译，或需 Ren'Py Generate Translations）",
    }));
  }

  function hideEn(id: string) {
    setOpenEn((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setFetchMsg((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return (
    <div className="line-list">
      <div className="editor-file-banner muted">
        正在编辑 <code>{selectedFile}</code> · {dialogueCount} 对话
        {branchCount > 0 ? ` · ${branchCount} 分支` : ""}
        {mediaCount > 0 ? ` · ${mediaCount} 视听` : ""}
        {callCount > 0 ? ` · ${callCount} 调用` : ""} · 可拉取英译 {paired}/
        {dialogueCount}
      </div>
      {visible.map((line) => {
        const depthPad = Math.min(line.branchDepth, 8) * 14;

        if (isPyCall(line.kind)) {
          const name = line.callName ?? "?";
          const args = line.callArgs ?? line.text;
          return (
            <article
              key={line.id}
              className="line-card media-card media-py_call"
              data-id={line.id}
              style={{ marginLeft: depthPad }}
            >
              <header className="line-meta">
                <span className="media-pill media-pill-py_call">
                  <span className="media-symbol" aria-hidden>
                    ƒ
                  </span>
                  $ call
                </span>
                {line.label && (
                  <span className="label-tag muted">@{line.label}</span>
                )}
                <span className="loc muted">L{line.line}</span>
              </header>
              <code className="media-statement">
                <span className="py-call-name">{name}</span>
                <span className="py-call-paren">(</span>
                <span className="py-call-args">{args}</span>
                <span className="py-call-paren">)</span>
              </code>
            </article>
          );
        }

        if (BRANCH_KINDS.has(line.kind)) {
          return (
            <article
              key={line.id}
              className={`line-card branch-card branch-${line.kind}`}
              data-id={line.id}
              style={{ marginLeft: depthPad }}
            >
              <header className="line-meta">
                <span className={`branch-pill branch-pill-${line.kind}`}>
                  {line.kind}
                </span>
                {line.label && (
                  <span className="label-tag muted">@{line.label}</span>
                )}
                <span className="loc muted">L{line.line}</span>
              </header>
              <code className="branch-condition">
                {line.kind === "else" ? "else:" : `${line.kind} ${line.text}:`}
              </code>
            </article>
          );
        }

        if (MEDIA_KINDS.has(line.kind)) {
          const meta = MEDIA_META[line.kind];
          return (
            <article
              key={line.id}
              className={`line-card media-card media-${line.kind}`}
              data-id={line.id}
              style={{ marginLeft: depthPad }}
            >
              <header className="line-meta">
                <span className={`media-pill media-pill-${line.kind}`}>
                  <span className="media-symbol" aria-hidden>
                    {meta.symbol}
                  </span>
                  {meta.label}
                </span>
                {line.label && (
                  <span className="label-tag muted">@{line.label}</span>
                )}
                <span className="loc muted">L{line.line}</span>
              </header>
              <code className="media-statement">
                {meta.prefix} {line.text}
              </code>
            </article>
          );
        }

        const zh = draftsZh[line.id] ?? line.text;
        const enBase = line.textEn ?? "";
        const en = draftsEn[line.id] ?? enBase;
        const dirtyZh = zh !== line.text;
        const dirtyEn =
          openEn[line.id] && line.tlFile != null && en !== enBase;
        const showing = !!openEn[line.id];
        const msg = fetchMsg[line.id];

        return (
          <article
            key={line.id}
            className={`line-card${dirtyZh || dirtyEn ? " dirty" : ""}`}
            data-id={line.id}
            style={{ marginLeft: depthPad }}
          >
            <header className="line-meta">
              <span className="speaker">
                {line.kind === "menu_caption"
                  ? "（选项）"
                  : line.speaker ?? "旁白"}
              </span>
              {line.label && (
                <span className="label-tag muted">@{line.label}</span>
              )}
              <span className="loc muted">L{line.line}</span>
              {line.branchDepth > 0 && (
                <span className="badge branch-depth-badge">
                  分支内 ·{line.branchDepth}
                </span>
              )}
              {(dirtyZh || dirtyEn) && (
                <span className="badge dirty-badge">未保存</span>
              )}
              <span className="line-meta-actions">
                {showing ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => hideEn(line.id)}
                  >
                    收起译文
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => fetchEn(line, zh)}
                  >
                    获取译文
                  </button>
                )}
              </span>
            </header>

            <label className="bi-field">
              <span className="bi-label">中文</span>
              <textarea
                className="line-textarea"
                value={zh}
                rows={Math.min(5, Math.max(2, zh.split("\n").length + 1))}
                onChange={(e) => onDraftZhChange(line.id, e.target.value)}
                spellCheck={false}
              />
            </label>

            {msg && <p className="fetch-msg muted">{msg}</p>}

            {showing && (
              <label className="bi-field en-panel">
                <span className="bi-label">
                  英文
                  {line.tlFile && (
                    <span className="muted bi-path"> · {line.tlFile}</span>
                  )}
                </span>
                <textarea
                  className="line-textarea en"
                  value={en}
                  rows={Math.min(5, Math.max(2, en.split("\n").length + 1))}
                  onChange={(e) => onDraftEnChange(line.id, e.target.value)}
                  spellCheck={false}
                />
              </label>
            )}
          </article>
        );
      })}
    </div>
  );
}
