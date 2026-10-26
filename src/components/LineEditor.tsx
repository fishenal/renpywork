"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isPendingId } from "@/lib/stage";
import {
  formatPlayStatement,
  formatSceneStatement,
  parsePlayArg,
  parseSceneArg,
} from "@/lib/media";
import {
  formatHideStatement,
  formatShowStatement,
  parseHideArg,
  parseShowArg,
} from "@/lib/sprite";
import type {
  CharacterRef,
  DialogueLine,
  DialogueLineKind,
  MediaOption,
  SpriteTagInfo,
} from "@/lib/types";

type MarkerInsertKind =
  | "show"
  | "hide"
  | "scene"
  | "play_music"
  | "play_sound"
  | "play_ambient";

type Props = {
  lines: DialogueLine[];
  characters: CharacterRef[];
  sprites: SpriteTagInfo[];
  transforms: string[];
  transitions: string[];
  backgrounds: MediaOption[];
  bgTransforms: string[];
  bgm: MediaOption[];
  ambient: MediaOption[];
  sfx: MediaOption[];
  fadeins: string[];
  draftsZh: Record<string, string>;
  draftsEn: Record<string, string>;
  /** Draft speaker ids; missing key → use line.speaker; "" means narrator */
  draftsSpeaker: Record<string, string | null>;
  draftsStatement: Record<string, string>;
  selectedFile: string | null;
  busy?: boolean;
  onDraftZhChange: (id: string, text: string) => void;
  onDraftEnChange: (id: string, text: string) => void;
  onDraftSpeakerChange: (id: string, speaker: string | null) => void;
  onDraftStatementChange: (id: string, statement: string) => void;
  onDeleteLine: (line: DialogueLine) => void;
  /** Returns new pending line id when staged */
  onInsertLine: (line: DialogueLine, speaker: string | null) => string | null;
  onInsertMarker: (
    after: DialogueLine,
    kind: MarkerInsertKind,
    statement: string,
  ) => string | null;
  onMoveLine: (line: DialogueLine, direction: "up" | "down") => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
};

const BRANCH_KINDS = new Set<DialogueLineKind>(["if", "elif", "else"]);
const MEDIA_EDIT_KINDS = new Set<DialogueLineKind>([
  "scene",
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

function canInsertAfterLine(line: DialogueLine): boolean {
  return (
    line.kind === "say" &&
    (line.allowInsertAfter || isPendingId(line.id))
  );
}

function canInsertMarkerAfter(line: DialogueLine): boolean {
  return line.kind !== "menu_caption" && line.kind !== "menu_choice";
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
  { symbol: string; label: string; channel?: "music" | "sound" | "ambient" }
> = {
  scene: { symbol: "▣", label: "场景" },
  play_music: { symbol: "♪", label: "BGM", channel: "music" },
  play_sound: { symbol: "♫", label: "SFX", channel: "sound" },
  play_ambient: { symbol: "〜", label: "环境音", channel: "ambient" },
};

function statementBaseForLine(line: DialogueLine): string {
  if (line.kind === "scene") return `scene ${line.text}`.trim();
  if (line.kind === "play_music") return `play music ${line.text}`.trim();
  if (line.kind === "play_sound") return `play sound ${line.text}`.trim();
  if (line.kind === "play_ambient") return `play ambient ${line.text}`.trim();
  if (line.kind === "show" || line.kind === "hide") {
    return `${line.kind} ${line.text}`.trim();
  }
  return line.text;
}

function optionLabel(o: MediaOption): string {
  return o.note ? `${o.name} · ${o.note}` : o.name;
}

function IconUp() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 12.5V3.5M8 3.5 4.5 7M8 3.5 11.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDown() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 3.5v9M8 12.5 4.5 9M8 12.5 11.5 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M4 6.5h5.5a3.5 3.5 0 1 1 0 7H8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6.5 3.5 3.5 6.5l3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 6.5H6.5a3.5 3.5 0 1 0 0 7H8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M9.5 3.5 12.5 6.5l-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function resolveSpeaker(
  line: DialogueLine,
  draftsSpeaker: Record<string, string | null>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(draftsSpeaker, line.id)) {
    return draftsSpeaker[line.id] ?? null;
  }
  return line.speaker;
}

function IconPlus() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      className="tb-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 4.5h9M6 4.5V3.25A.75.75 0 0 1 6.75 2.5h2.5a.75.75 0 0 1 .75.75V4.5m1.5 0V12.5a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4.5M6.5 7v4.5M9.5 7v4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LineEditor({
  lines,
  characters,
  sprites,
  transforms,
  transitions,
  backgrounds,
  bgTransforms,
  bgm,
  ambient,
  sfx,
  fadeins,
  draftsZh,
  draftsEn,
  draftsSpeaker,
  draftsStatement,
  selectedFile,
  busy = false,
  onDraftZhChange,
  onDraftEnChange,
  onDraftSpeakerChange,
  onDraftStatementChange,
  onDeleteLine,
  onInsertLine,
  onInsertMarker,
  onMoveLine,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: Props) {
  const [openEn, setOpenEn] = useState<Record<string, true>>({});
  const [fetchMsg, setFetchMsg] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenEn({});
    setFetchMsg({});
    setSelectedId(null);
    setAddMenuOpen(false);
  }, [selectedFile]);

  useEffect(() => {
    setAddMenuOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedFile) return;
    const stillThere = lines.some(
      (l) => l.file === selectedFile && l.id === selectedId,
    );
    if (!stillThere) setSelectedId(null);
  }, [lines, selectedFile, selectedId]);

  useEffect(() => {
    if (!addMenuOpen) return;
    function onDocPointerDown(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [addMenuOpen]);

  if (!selectedFile) {
    return (
      <div className="line-editor">
        <p className="empty-hint">请从左侧文件列表选择一个 .rpy 文件开始编辑。</p>
      </div>
    );
  }

  const visible = lines.filter((l) => l.file === selectedFile);

  if (visible.length === 0) {
    return (
      <div className="line-editor">
        <p className="empty-hint">
          <code>{selectedFile}</code> 中没有扫描到对话行。
        </p>
      </div>
    );
  }

  const selectedLine =
    selectedId != null
      ? (visible.find((l) => l.id === selectedId) ?? null)
      : null;

  const dialogueCount = visible.filter((l) => isEditable(l.kind)).length;
  const branchCount = visible.filter((l) => BRANCH_KINDS.has(l.kind)).length;
  const mediaCount = visible.filter((l) => MEDIA_EDIT_KINDS.has(l.kind)).length;
  const spriteCount = visible.filter(
    (l) => l.kind === "show" || l.kind === "hide",
  ).length;
  const callCount = visible.filter((l) => isPyCall(l.kind)).length;
  const paired = visible.filter((l) => l.tlFile && l.textEn != null).length;
  const blocks = groupByLabel(visible);

  const canInsertText =
    selectedLine != null && canInsertAfterLine(selectedLine);
  const canInsertMarker =
    selectedLine != null && canInsertMarkerAfter(selectedLine);
  const canOpenAddMenu = selectedLine != null;
  const canDelete = selectedLine != null;
  const selectedIdx = selectedLine
    ? visible.findIndex((l) => l.id === selectedLine.id)
    : -1;
  const canMoveUp = selectedIdx > 0;
  const canMoveDown =
    selectedIdx >= 0 && selectedIdx < visible.length - 1;

  const positionTransforms = transforms.filter((t) =>
    t.startsWith("sprite_"),
  );
  const fxTransforms = transforms.filter((t) => t.startsWith("shake"));

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

  function focusNewId(newId: string | null) {
    if (!newId) return;
    setSelectedId(newId);
    window.requestAnimationFrame(() => {
      // Keep document pinned — scrollIntoView can shift window.scrollY
      // under overflow:hidden and leave the shell unrecoverable.
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const el = listRef.current?.querySelector(
        `[data-id="${newId}"]`,
      ) as HTMLElement | null;
      const scroller = listRef.current;
      if (!el || !scroller) return;
      const elRect = el.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      const delta =
        elRect.top -
        scRect.top -
        scRect.height / 2 +
        elRect.height / 2;
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop + delta),
        behavior: "smooth",
      });
    });
  }

  function defaultSpriteTag(): string {
    return sprites[0]?.tag ?? characters[0]?.name ?? "lz";
  }

  function runAddMenuAction(action: () => void) {
    setAddMenuOpen(false);
    action();
  }

  function handleAddText() {
    if (!selectedLine || !canInsertAfterLine(selectedLine)) return;
    const speaker = resolveSpeaker(selectedLine, draftsSpeaker);
    focusNewId(onInsertLine(selectedLine, speaker));
  }

  function handleAddShowSprite() {
    if (!selectedLine || !canInsertMarkerAfter(selectedLine)) return;
    const tag = defaultSpriteTag();
    const pos = positionTransforms[0] ?? "sprite_left";
    const statement = formatShowStatement({
      tag,
      attr: null,
      atList: [pos],
      withTransition: null,
    });
    focusNewId(onInsertMarker(selectedLine, "show", statement));
  }

  function handleAddHideSprite() {
    if (!selectedLine || !canInsertMarkerAfter(selectedLine)) return;
    const tag = defaultSpriteTag();
    const statement = formatHideStatement({ tag, withTransition: null });
    focusNewId(onInsertMarker(selectedLine, "hide", statement));
  }

  function handleAddScene() {
    if (!selectedLine || !canInsertMarkerAfter(selectedLine)) return;
    const image = backgrounds[0]?.name ?? "bg bedroom";
    const statement = formatSceneStatement({
      image,
      atList: [],
      withTransition: null,
    });
    focusNewId(onInsertMarker(selectedLine, "scene", statement));
  }

  function handleAddPlay(
    channel: "music" | "sound" | "ambient",
    pool: MediaOption[],
    fallback: string,
    fadein: string | null,
  ) {
    if (!selectedLine || !canInsertMarkerAfter(selectedLine)) return;
    const audio = pool[0]?.name ?? fallback;
    const statement = formatPlayStatement({ channel, audio, fadein });
    const kind =
      channel === "music"
        ? "play_music"
        : channel === "sound"
          ? "play_sound"
          : "play_ambient";
    focusNewId(onInsertMarker(selectedLine, kind, statement));
  }

  function handleToolbarDelete() {
    if (!selectedLine) return;
    const id = selectedLine.id;
    const idx = visible.findIndex((l) => l.id === id);
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null;
    onDeleteLine(selectedLine);
    setSelectedId(next && next.id !== id ? next.id : null);
  }

  function renderSpriteCard(line: DialogueLine): ReactNode {
    const depthPad = Math.min(line.branchDepth, 8) * 14;
    const select = () => setSelectedId(line.id);
    const base = `${line.kind} ${line.text}`.trim();
    const statement = draftsStatement[line.id] ?? base;
    const dirty = statement !== base;
    const isShow = line.kind === "show";

    const showSpec = isShow
      ? parseShowArg(statement.replace(/^show\s+/, ""))
      : null;
    const hideSpec = !isShow
      ? parseHideArg(statement.replace(/^hide\s+/, ""))
      : null;

    const tag = (isShow ? showSpec?.tag : hideSpec?.tag) ?? "";
    const attr = showSpec?.attr ?? null;
    const atList = showSpec?.atList ?? [];
    const withTransition = isShow
      ? (showSpec?.withTransition ?? null)
      : (hideSpec?.withTransition ?? null);

    const tagInfo = sprites.find((s) => s.tag === tag);
    const attrs = tagInfo?.attrs ?? [];
    const primaryAt =
      atList.find((a) => a.startsWith("sprite_")) ?? atList[0] ?? "";
    const fxAt = atList.find((a) => a.startsWith("shake")) ?? "";

    function commitShow(next: {
      tag?: string;
      attr?: string | null;
      primaryAt?: string;
      fxAt?: string;
      withTransition?: string | null;
    }) {
      const t = next.tag ?? tag;
      const a = next.attr !== undefined ? next.attr : attr;
      const p = next.primaryAt !== undefined ? next.primaryAt : primaryAt;
      const f = next.fxAt !== undefined ? next.fxAt : fxAt;
      const w =
        next.withTransition !== undefined
          ? next.withTransition
          : withTransition;
      const list = [p, f].filter(Boolean);
      onDraftStatementChange(
        line.id,
        formatShowStatement({
          tag: t || "lz",
          attr: a,
          atList: list,
          withTransition: w,
        }),
      );
    }

    function commitHide(next: {
      tag?: string;
      withTransition?: string | null;
    }) {
      onDraftStatementChange(
        line.id,
        formatHideStatement({
          tag: next.tag ?? (tag || "lz"),
          withTransition:
            next.withTransition !== undefined
              ? next.withTransition
              : withTransition,
        }),
      );
    }

    return (
      <article
        key={line.id}
        className={cardClass(
          line,
          ` media-card media-${line.kind}${dirty ? " dirty" : ""}`,
        )}
        data-id={line.id}
        style={{ marginLeft: depthPad }}
        onClick={select}
      >
        <header className="line-meta">
          <span className={`media-pill media-pill-${line.kind}`}>
            <span className="media-symbol" aria-hidden>
              {isShow ? "◇" : "◆"}
            </span>
            {isShow ? "显示立绘" : "隐藏立绘"}
          </span>
          <span className="loc muted">
            {isPendingId(line.id) ? "新" : `L${line.line}`}
          </span>
          {isPendingId(line.id) && (
            <span className="badge pending-badge">待新增</span>
          )}
          {dirty && <span className="badge dirty-badge">未保存</span>}
          <span className="line-meta-actions">
            <button
              type="button"
              className="btn small ghost danger"
              disabled={busy}
              title="删除此立绘指令"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteLine(line);
                if (selectedId === line.id) setSelectedId(null);
              }}
            >
              删除
            </button>
          </span>
        </header>

        <div
          className="sprite-edit"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="sprite-field">
            <span>立绘</span>
            <select
              className="speaker-select"
              value={tag}
              disabled={busy}
              onChange={(e) => {
                const nextTag = e.target.value;
                if (isShow) {
                  commitShow({ tag: nextTag, attr: null });
                } else {
                  commitHide({ tag: nextTag });
                }
              }}
            >
              {sprites.map((s) => (
                <option key={s.tag} value={s.tag}>
                  {s.tag}
                </option>
              ))}
              {tag && !sprites.some((s) => s.tag === tag) && (
                <option value={tag}>{tag}（未在资源中）</option>
              )}
            </select>
          </label>

          {isShow && (
            <label className="sprite-field">
              <span>表情</span>
              <select
                className="speaker-select"
                value={attr ?? ""}
                disabled={busy}
                onChange={(e) =>
                  commitShow({
                    attr: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">默认</option>
                {attrs.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                {attr && !attrs.includes(attr) && (
                  <option value={attr}>{attr}（自定义）</option>
                )}
              </select>
            </label>
          )}

          {isShow && (
            <label className="sprite-field">
              <span>位置</span>
              <select
                className="speaker-select"
                value={primaryAt}
                disabled={busy}
                onChange={(e) => commitShow({ primaryAt: e.target.value })}
              >
                <option value="">（无）</option>
                {positionTransforms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {primaryAt &&
                  !positionTransforms.includes(primaryAt) &&
                  !primaryAt.startsWith("shake") && (
                    <option value={primaryAt}>{primaryAt}</option>
                  )}
              </select>
            </label>
          )}

          {isShow && (
            <label className="sprite-field">
              <span>动效</span>
              <select
                className="speaker-select"
                value={fxAt}
                disabled={busy}
                onChange={(e) => commitShow({ fxAt: e.target.value })}
              >
                <option value="">无</option>
                {fxTransforms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {fxAt && !fxTransforms.includes(fxAt) && (
                  <option value={fxAt}>{fxAt}</option>
                )}
              </select>
            </label>
          )}

          <label className="sprite-field">
            <span>with</span>
            <select
              className="speaker-select"
              value={withTransition ?? ""}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value === "" ? null : e.target.value;
                if (isShow) commitShow({ withTransition: v });
                else commitHide({ withTransition: v });
              }}
            >
              <option value="">无</option>
              {transitions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {withTransition && !transitions.includes(withTransition) && (
                <option value={withTransition}>{withTransition}</option>
              )}
            </select>
          </label>
        </div>

        <code className="media-statement sprite-preview">{statement}</code>
      </article>
    );
  }

  function renderMediaCard(line: DialogueLine): ReactNode {
    const depthPad = Math.min(line.branchDepth, 8) * 14;
    const select = () => setSelectedId(line.id);
    const meta = MEDIA_META[line.kind];
    const base = statementBaseForLine(line);
    const statement = draftsStatement[line.id] ?? base;
    const dirty = statement !== base;

    if (line.kind === "scene") {
      const arg = statement.replace(/^scene\s+/, "");
      const spec = parseSceneArg(arg) ?? {
        image: arg.trim() || "black",
        atList: [] as string[],
        withTransition: null as string | null,
      };
      const primaryAt = spec.atList[0] ?? "";

      function commit(next: {
        image?: string;
        primaryAt?: string;
        withTransition?: string | null;
      }) {
        const image = next.image ?? spec.image;
        const at =
          next.primaryAt !== undefined ? next.primaryAt : primaryAt;
        const w =
          next.withTransition !== undefined
            ? next.withTransition
            : spec.withTransition;
        onDraftStatementChange(
          line.id,
          formatSceneStatement({
            image,
            atList: at ? [at] : [],
            withTransition: w,
          }),
        );
      }

      return (
        <article
          key={line.id}
          className={cardClass(
            line,
            ` media-card media-scene${dirty ? " dirty" : ""}`,
          )}
          data-id={line.id}
          style={{ marginLeft: depthPad }}
          onClick={select}
        >
          <header className="line-meta">
            <span className="media-pill media-pill-scene">
              <span className="media-symbol" aria-hidden>
                {meta.symbol}
              </span>
              {meta.label}
            </span>
            <span className="loc muted">
              {isPendingId(line.id) ? "新" : `L${line.line}`}
            </span>
            {dirty && <span className="badge dirty-badge">未保存</span>}
            <span className="line-meta-actions">
              <button
                type="button"
                className="btn small ghost danger"
                disabled={busy}
                title="删除此场景指令"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteLine(line);
                  if (selectedId === line.id) setSelectedId(null);
                }}
              >
                删除
              </button>
            </span>
          </header>
          <div className="sprite-edit" onClick={(e) => e.stopPropagation()}>
            <label className="sprite-field">
              <span>背景</span>
              <select
                className="speaker-select"
                value={spec.image}
                disabled={busy}
                onChange={(e) => commit({ image: e.target.value })}
              >
                {backgrounds.map((b) => (
                  <option key={b.name} value={b.name}>
                    {optionLabel(b)}
                  </option>
                ))}
                {spec.image &&
                  !backgrounds.some((b) => b.name === spec.image) && (
                    <option value={spec.image}>{spec.image}</option>
                  )}
              </select>
            </label>
            <label className="sprite-field">
              <span>运镜</span>
              <select
                className="speaker-select"
                value={primaryAt}
                disabled={busy}
                onChange={(e) => commit({ primaryAt: e.target.value })}
              >
                <option value="">无</option>
                {bgTransforms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {primaryAt && !bgTransforms.includes(primaryAt) && (
                  <option value={primaryAt}>{primaryAt}</option>
                )}
              </select>
            </label>
            <label className="sprite-field">
              <span>with</span>
              <select
                className="speaker-select"
                value={spec.withTransition ?? ""}
                disabled={busy}
                onChange={(e) =>
                  commit({
                    withTransition:
                      e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">无</option>
                {transitions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {spec.withTransition &&
                  !transitions.includes(spec.withTransition) && (
                    <option value={spec.withTransition}>
                      {spec.withTransition}
                    </option>
                  )}
              </select>
            </label>
          </div>
          <code className="media-statement sprite-preview">{statement}</code>
        </article>
      );
    }

    // play music / sound / ambient
    const channel =
      line.kind === "play_music"
        ? "music"
        : line.kind === "play_ambient"
          ? "ambient"
          : "sound";
    const arg = statement.replace(/^play\s+/, "");
    const parsed = parsePlayArg(arg);
    const audio = parsed?.audio ?? line.text.split(/\s+/)[0] ?? "";
    const fadein = parsed?.fadein ?? null;
    const options =
      channel === "music" ? bgm : channel === "ambient" ? ambient : sfx;

    function commitPlay(next: {
      audio?: string;
      fadein?: string | null;
    }) {
      onDraftStatementChange(
        line.id,
        formatPlayStatement({
          channel,
          audio: next.audio ?? audio,
          fadein:
            next.fadein !== undefined ? next.fadein : fadein,
        }),
      );
    }

    return (
      <article
        key={line.id}
        className={cardClass(
          line,
          ` media-card media-${line.kind}${dirty ? " dirty" : ""}`,
        )}
        data-id={line.id}
        style={{ marginLeft: depthPad }}
        onClick={select}
      >
        <header className="line-meta">
          <span className={`media-pill media-pill-${line.kind}`}>
            <span className="media-symbol" aria-hidden>
              {meta.symbol}
            </span>
            {meta.label}
          </span>
          <span className="loc muted">
            {isPendingId(line.id) ? "新" : `L${line.line}`}
          </span>
          {dirty && <span className="badge dirty-badge">未保存</span>}
          <span className="line-meta-actions">
            <button
              type="button"
              className="btn small ghost danger"
              disabled={busy}
              title="删除此音频指令"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteLine(line);
                if (selectedId === line.id) setSelectedId(null);
              }}
            >
              删除
            </button>
          </span>
        </header>
        <div className="sprite-edit" onClick={(e) => e.stopPropagation()}>
          <label className="sprite-field">
            <span>资源</span>
            <select
              className="speaker-select media-audio-select"
              value={audio}
              disabled={busy}
              onChange={(e) => commitPlay({ audio: e.target.value })}
            >
              {options.map((o) => (
                <option key={o.name} value={o.name}>
                  {optionLabel(o)}
                </option>
              ))}
              {audio && !options.some((o) => o.name === audio) && (
                <option value={audio}>{audio}</option>
              )}
            </select>
          </label>
          <label className="sprite-field">
            <span>fadein</span>
            <select
              className="speaker-select"
              value={fadein ?? ""}
              disabled={busy}
              onChange={(e) =>
                commitPlay({
                  fadein: e.target.value === "" ? null : e.target.value,
                })
              }
            >
              <option value="">无</option>
              {fadeins.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {fadein && !fadeins.includes(fadein) && (
                <option value={fadein}>{fadein}</option>
              )}
            </select>
          </label>
        </div>
        <code className="media-statement sprite-preview">{statement}</code>
      </article>
    );
  }

  function cardClass(line: DialogueLine, extra = ""): string {
    const selected = selectedId === line.id ? " is-selected" : "";
    return `line-card${extra}${selected}`;
  }

  function renderCard(line: DialogueLine): ReactNode {
    const depthPad = Math.min(line.branchDepth, 8) * 14;
    const select = () => setSelectedId(line.id);

    if (isPyCall(line.kind)) {
      const name = line.callName ?? "?";
      const args = line.callArgs ?? line.text;
      return (
        <article
          key={line.id}
          className={cardClass(line, " media-card media-py_call")}
          data-id={line.id}
          style={{ marginLeft: depthPad }}
          onClick={select}
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
          className={cardClass(line, ` branch-card branch-${line.kind}`)}
          data-id={line.id}
          style={{ marginLeft: depthPad }}
          onClick={select}
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

    if (line.kind === "show" || line.kind === "hide") {
      return renderSpriteCard(line);
    }

    if (MEDIA_EDIT_KINDS.has(line.kind)) {
      return renderMediaCard(line);
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

    return (
      <article
        key={line.id}
        className={cardClass(line, dirty ? " dirty" : "")}
        data-id={line.id}
        style={{ marginLeft: depthPad }}
        onClick={select}
      >
        <header className="line-meta">
          {isSay ? (
            <label
              className="speaker-picker"
              onClick={(e) => e.stopPropagation()}
            >
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
            {showing ? (
              <button
                type="button"
                className="btn small ghost"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  hideEn(line.id);
                }}
              >
                收起译文
              </button>
            ) : (
              <button
                type="button"
                className="btn small"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  fetchEn(line, zh);
                }}
              >
                获取译文
              </button>
            )}
          </span>
        </header>

        <label className="bi-field" onClick={(e) => e.stopPropagation()}>
          <span className="bi-label">中文</span>
          <textarea
            className="line-textarea"
            value={zh}
            rows={Math.min(5, Math.max(2, zh.split("\n").length + 1))}
            onChange={(e) => onDraftZhChange(line.id, e.target.value)}
            onFocus={select}
            spellCheck={false}
          />
        </label>

        {msg && <p className="fetch-msg muted">{msg}</p>}

        {showing && (
          <label className="bi-field en-panel" onClick={(e) => e.stopPropagation()}>
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
              onFocus={select}
              spellCheck={false}
            />
          </label>
        )}
      </article>
    );
  }

  return (
    <div className="line-editor">
      <div className="editor-chrome">
      <div className="editor-file-banner muted">
        正在编辑 <code>{selectedFile}</code> · {dialogueCount} 对话
        {branchCount > 0 ? ` · ${branchCount} 分支` : ""}
        {mediaCount > 0 ? ` · ${mediaCount} 视听` : ""}
        {spriteCount > 0 ? ` · ${spriteCount} 立绘` : ""}
        {callCount > 0 ? ` · ${callCount} 调用` : ""} · 可拉取英译 {paired}/
        {dialogueCount}
      </div>

      <div className="editor-toolbar">
        <button
          type="button"
          className="btn small ghost tb-btn"
          disabled={busy || !canUndo}
          title="撤销 (Ctrl/⌘ Z)"
          onClick={() => onUndo?.()}
        >
          <IconUndo />
          撤销
        </button>
        <button
          type="button"
          className="btn small ghost tb-btn"
          disabled={busy || !canRedo}
          title="重做 (Ctrl/⌘ Shift Z)"
          onClick={() => onRedo?.()}
        >
          <IconRedo />
          重做
        </button>
        <span className="tb-sep" aria-hidden />
        <div className="tb-menu-wrap" ref={addMenuRef}>
          <button
            type="button"
            className="btn small tb-btn"
            disabled={busy || !canOpenAddMenu}
            aria-expanded={addMenuOpen}
            aria-haspopup="menu"
            title={
              !selectedLine
                ? "先选中一条条目"
                : "在选中条目下方新增"
            }
            onClick={() => setAddMenuOpen((open) => !open)}
          >
            <IconPlus />
            新增
          </button>
          {addMenuOpen && (
            <div className="tb-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertText}
                title={
                  canInsertText
                    ? "新增空对话"
                    : "需选中 menu 外的 say 行才能新增文本"
                }
                onClick={() => runAddMenuAction(handleAddText)}
              >
                文本
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker
                    ? "显示立绘"
                    : "菜单选项处不可插入"
                }
                onClick={() => runAddMenuAction(handleAddShowSprite)}
              >
                显示立绘
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker
                    ? "隐藏立绘"
                    : "菜单选项处不可插入"
                }
                onClick={() => runAddMenuAction(handleAddHideSprite)}
              >
                隐藏立绘
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker ? "切换场景" : "菜单选项处不可插入"
                }
                onClick={() => runAddMenuAction(handleAddScene)}
              >
                场景
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker ? "播放 BGM" : "菜单选项处不可插入"
                }
                onClick={() =>
                  runAddMenuAction(() =>
                    handleAddPlay(
                      "music",
                      bgm,
                      "audio.bgm_main",
                      "BGM_FADEIN",
                    ),
                  )
                }
              >
                BGM
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker ? "播放环境音" : "菜单选项处不可插入"
                }
                onClick={() =>
                  runAddMenuAction(() =>
                    handleAddPlay("ambient", ambient, "audio.amb_room", "0.5"),
                  )
                }
              >
                环境音
              </button>
              <button
                type="button"
                role="menuitem"
                className="tb-menu-item"
                disabled={busy || !canInsertMarker}
                title={
                  canInsertMarker ? "播放音效" : "菜单选项处不可插入"
                }
                onClick={() =>
                  runAddMenuAction(() =>
                    handleAddPlay("sound", sfx, "audio.sfx_click", null),
                  )
                }
              >
                音效
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn small ghost tb-btn"
          disabled={busy || !canMoveUp}
          title={
            !selectedLine
              ? "先选中一条条目"
              : !canMoveUp
                ? "已在最上方"
                : "与上一条换位"
          }
          onClick={() => selectedLine && onMoveLine(selectedLine, "up")}
        >
          <IconUp />
          上移
        </button>
        <button
          type="button"
          className="btn small ghost tb-btn"
          disabled={busy || !canMoveDown}
          title={
            !selectedLine
              ? "先选中一条条目"
              : !canMoveDown
                ? "已在最下方"
                : "与下一条换位"
          }
          onClick={() => selectedLine && onMoveLine(selectedLine, "down")}
        >
          <IconDown />
          下移
        </button>
        <button
          type="button"
          className="btn small ghost danger tb-btn"
          disabled={busy || !canDelete}
          title={
            !selectedLine ? "先选中一条条目" : "删除当前选中条目"
          }
          onClick={handleToolbarDelete}
        >
          <IconTrash />
          删除
        </button>
        <span className="editor-toolbar-hint muted">
          {selectedLine
            ? `已选 ${
                isPendingId(selectedLine.id)
                  ? "新行"
                  : `L${selectedLine.line}`
              }`
            : "点击条目以选中"}
        </span>
      </div>
      </div>

      <div className="line-list" ref={listRef}>
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
    </div>
  );
}
