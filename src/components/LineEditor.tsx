"use client";

import type { DialogueLine } from "@/lib/types";

type Props = {
  lines: DialogueLine[];
  drafts: Record<string, string>;
  fileFilter: string;
  onDraftChange: (id: string, text: string) => void;
};

export function LineEditor({ lines, drafts, fileFilter, onDraftChange }: Props) {
  const filter = fileFilter.trim().toLowerCase();
  const visible = filter
    ? lines.filter((l) => l.file.toLowerCase().includes(filter))
    : lines;

  if (lines.length === 0) {
    return <p className="empty-hint">尚未扫描到对话行。打开项目后点击「重新扫描」。</p>;
  }

  if (visible.length === 0) {
    return <p className="empty-hint">没有匹配「{fileFilter}」的行。</p>;
  }

  return (
    <div className="line-list">
      {visible.map((line) => {
        const draft = drafts[line.id] ?? line.text;
        const dirty = draft !== line.text;
        return (
          <article
            key={line.id}
            className={`line-card${dirty ? " dirty" : ""}`}
            data-id={line.id}
          >
            <header className="line-meta">
              <span className="speaker">
                {line.kind === "menu_caption"
                  ? "（选项）"
                  : line.speaker ?? "旁白"}
              </span>
              <span className="loc muted">
                {line.file}:{line.line}
              </span>
              {dirty && <span className="badge dirty-badge">未保存</span>}
            </header>
            <textarea
              className="line-textarea"
              value={draft}
              rows={Math.min(6, Math.max(2, draft.split("\n").length + 1))}
              onChange={(e) => onDraftChange(line.id, e.target.value)}
              spellCheck={false}
            />
          </article>
        );
      })}
    </div>
  );
}
