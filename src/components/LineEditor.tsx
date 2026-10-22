"use client";

import type { DialogueLine } from "@/lib/types";

type Props = {
  lines: DialogueLine[];
  draftsZh: Record<string, string>;
  draftsEn: Record<string, string>;
  selectedFile: string | null;
  onDraftZhChange: (id: string, text: string) => void;
  onDraftEnChange: (id: string, text: string) => void;
};

export function LineEditor({
  lines,
  draftsZh,
  draftsEn,
  selectedFile,
  onDraftZhChange,
  onDraftEnChange,
}: Props) {
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

  const paired = visible.filter((l) => l.tlFile).length;

  return (
    <div className="line-list">
      <div className="editor-file-banner muted">
        正在编辑 <code>{selectedFile}</code> · {visible.length} 行 · 英文对照{" "}
        {paired}/{visible.length}
      </div>
      {visible.map((line) => {
        const zh = draftsZh[line.id] ?? line.text;
        const enBase = line.textEn ?? "";
        const en = draftsEn[line.id] ?? enBase;
        const dirtyZh = zh !== line.text;
        const dirtyEn = line.tlFile != null && en !== enBase;
        const stale =
          line.tlFile != null &&
          line.tlCommentZh != null &&
          zh !== line.tlCommentZh;
        const hasTl = line.tlFile != null;

        return (
          <article
            key={line.id}
            className={`line-card${dirtyZh || dirtyEn ? " dirty" : ""}${stale ? " stale" : ""}`}
            data-id={line.id}
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
              {stale && (
                <span className="badge stale-badge" title="中文与 tl 注释不一致">
                  译文待校
                </span>
              )}
              {(dirtyZh || dirtyEn) && (
                <span className="badge dirty-badge">未保存</span>
              )}
            </header>

            <div className="bilingual">
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
              <label className="bi-field">
                <span className="bi-label">
                  英文
                  {hasTl ? (
                    <span className="muted bi-path"> · {line.tlFile}</span>
                  ) : (
                    <span className="muted"> · 无配对</span>
                  )}
                </span>
                <textarea
                  className="line-textarea en"
                  value={hasTl ? en : ""}
                  placeholder={
                    hasTl
                      ? "英文译文（可改）"
                      : "无 tl 配对；保存中文后若仍无对照，需在 Ren'Py 生成翻译"
                  }
                  disabled={!hasTl}
                  rows={Math.min(
                    5,
                    Math.max(2, (hasTl ? en : "").split("\n").length + 1),
                  )}
                  onChange={(e) => onDraftEnChange(line.id, e.target.value)}
                  spellCheck={false}
                />
              </label>
            </div>
          </article>
        );
      })}
    </div>
  );
}
