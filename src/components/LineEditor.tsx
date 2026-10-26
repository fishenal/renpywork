"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isPendingId } from "@/lib/stage";
import type {
  CharacterRef,
  DialogueLine,
  DialogueLineKind,
} from "@/lib/types";

type Props = {
  lines: DialogueLine[];
  characters: CharacterRef[];
  draftsZh: Record<string, string>;
  draftsEn: Record<string, string>;
  /** Draft speaker ids; missing key → use line.speaker; "" means narrator */
  draftsSpeaker: Record<string, string | null>;
  selectedFile: string | null;
  busy?: boolean;
  onDraftZhChange: (id: string, text: string) => void;
  onDraftEnChange: (id: string, text: string) => void;
  onDraftSpeakerChange: (id: string, speaker: string | null) => void;
  onDeleteLine: (line: DialogueLine) => void;
  onInsertLine: (line: DialogueLine, speaker: string | null) => void;
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

const LABEL_TONE_COUNT = 6;

function isEditable(kind: DialogueLineKind): boolean {
  return (
    kind === "say" || kind === "menu_caption" || kind === "menu_choice"
  );
}

function isPyCall(kind: DialogueLineKind): boolean {
  return kind === "py_call";
}

/** Stable 0..LABEL_TONE_COUNT-1 tint index from label name. */
function labelTone(label: string | null): number {
  if (!label) return 0;
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  return h % LABEL_TONE_COUNT;
}

type LabelBlock = {
  key: string;
  label: string | null;
  tone: number;
  lines: DialogueLine[];
};

function groupByLabel(lines: DialogueLine[]): LabelBlock[] {
  const blocks: LabelBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last.label === line.label) {
      last.lines.push(line);
    } else {
      blocks.push({
        key: `${line.label ?? "_"}:${line.id}`,
        label: line.label,
        tone: labelTone(line.label),
        lines: [line],
      });
    }
  }
  return blocks;
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

function resolveSpeaker(
  line: DialogueLine,
  draftsSpeaker: Record<string, string | null>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(draftsSpeaker, line.id)) {
    return draftsSpeaker[line.id] ?? null;
  }
  return line.speaker;
}

export function LineEditor({
  lines,
  characters,
  draftsZh,
  draftsEn,
  draftsSpeaker,
  selectedFile,
  busy = false,
  onDraftZhChange,
  onDraftEnChange,
  onDraftSpeakerChange,
  onDeleteLine,
  onInsertLine,
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
  const blocks = groupByLabel(visible);

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

  function renderCard(line: DialogueLine): ReactNode {
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
    const speaker = resolveSpeaker(line, draftsSpeaker);
    const dirtyZh = zh !== line.text;
    const dirtySpeaker = speaker !== line.speaker;
    const dirtyEn = openEn[line.id] && line.tlFile != null && en !== enBase;
    const dirty = dirtyZh || dirtyEn || dirtySpeaker;
    const showing = !!openEn[line.id];
    const msg = fetchMsg[line.id];
    const isSay = line.kind === "say";
    const canInsert =
      isSay && (line.allowInsertAfter || isPendingId(line.id));

    return (
      <article
        key={line.id}
        className={`line-card${dirty ? " dirty" : ""}`}
        data-id={line.id}
        style={{ marginLeft: depthPad }}
      >
        <header className="line-meta">
          {isSay ? (
            <label className="speaker-picker">
              <span className="visually-hidden">说话人</span>
              <select
                className="speaker-select"
                value={speaker ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value;
                  onDraftSpeakerChange(line.id, v === "" ? null : v);
                }}
              >
                <option value="">旁白</option>
                {characters.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.note ? `${c.name} · ${c.note}` : c.name}
                  </option>
                ))}
                {speaker &&
                  !characters.some((c) => c.name === speaker) && (
                    <option value={speaker}>{speaker}（未在资源中）</option>
                  )}
              </select>
            </label>
          ) : (
            <span className="speaker">
              {line.kind === "menu_caption"
                ? "菜单"
                : line.kind === "menu_choice"
                  ? "（选项）"
                  : (line.speaker ?? "旁白")}
            </span>
          )}
          <span className="loc muted">
            {isPendingId(line.id) ? "新" : `L${line.line}`}
          </span>
          {isPendingId(line.id) && (
            <span className="badge pending-badge">待新增</span>
          )}
          {line.branchDepth > 0 && (
            <span className="badge branch-depth-badge">
              分支内 ·{line.branchDepth}
            </span>
          )}
          {dirty && <span className="badge dirty-badge">未保存</span>}
          <span className="line-meta-actions">
            {isSay && (
              <button
                type="button"
                className="btn small ghost"
                disabled={busy || !canInsert}
                title={
                  canInsert
                    ? "在下方暂存新增空对话（点保存写入）"
                    : "此处不可新增（menu 块内或非脚本对话）"
                }
                onClick={() => onInsertLine(line, speaker)}
              >
                新增
              </button>
            )}
            <button
              type="button"
              className="btn small ghost danger"
              disabled={busy}
              title="暂存删除（点保存写入）"
              onClick={() => onDeleteLine(line)}
            >
              删除
            </button>
            {showing ? (
              <button
                type="button"
                className="btn small ghost"
                disabled={busy}
                onClick={() => hideEn(line.id)}
              >
                收起译文
              </button>
            ) : (
              <button
                type="button"
                className="btn small"
                disabled={busy}
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
      {blocks.map((block) => (
        <section
          key={block.key}
          className={`label-block label-tone-${block.tone}`}
          data-label={block.label ?? ""}
        >
          <header className="label-block-head">
            <span className="label-chip">
              {block.label ? `@${block.label}` : "（无 label）"}
            </span>
            <span className="label-block-count muted">
              {block.lines.length} 行
            </span>
          </header>
          <div className="label-block-body">
            {block.lines.map((line) => renderCard(line))}
          </div>
        </section>
      ))}
    </div>
  );
}
