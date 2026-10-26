import fs from "fs";
import { assertPathInsideGameRoot } from "./project";
import { isPendingId } from "./stage";
import type {
  LineAnchor,
  StagedContent,
  StagedStructureOp,
  WriteEdit,
} from "./types";

function escapeForQuotes(text: string, quote: '"' | "'"): string {
  if (quote === '"') {
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Replace the first quoted string on a line with new text, preserving
 * indentation, speaker, trailing colon (menu), `#` prefix, old/new, and comments.
 */
export function replaceQuotedOnLine(line: string, newText: string): string {
  const match = line.match(/^(.*?)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(.*)$/);
  if (!match) {
    throw new Error("该行找不到可替换的引号字符串");
  }
  const before = match[1];
  const quoted = match[2];
  const after = match[3];
  const q = quoted[0] as '"' | "'";
  return `${before}${q}${escapeForQuotes(newText, q)}${q}${after}`;
}

/**
 * Rewrite a say line's speaker + quoted text, preserving indent and trailing comment.
 * `speaker === null` → narrator form (`"text"`).
 */
export function rewriteSayLine(
  line: string,
  newText: string,
  speaker: string | null,
): string {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const match = line.match(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(.*)$/);
  if (!match) {
    throw new Error("该行找不到可替换的引号字符串");
  }
  const after = match[2];
  if (after.trimStart().startsWith(":")) {
    throw new Error("菜单选项行不能改说话人");
  }
  const q = match[1][0] as '"' | "'";
  const body = `${q}${escapeForQuotes(newText, q)}${q}`;
  if (speaker && speaker.trim()) {
    if (!/^[A-Za-z_][\w]*$/.test(speaker)) {
      throw new Error("说话人标识无效");
    }
    return `${indent}${speaker} ${body}${after}`;
  }
  return `${indent}${body}${after}`;
}

export function applyEdits(
  gameRoot: string,
  edits: WriteEdit[],
): { updatedFiles: string[]; errors: string[] } {
  const byFile = new Map<string, WriteEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.file) ?? [];
    list.push(edit);
    byFile.set(edit.file, list);
  }

  const updatedFiles: string[] = [];
  const errors: string[] = [];

  for (const [relFile, fileEdits] of byFile) {
    const allowTl = fileEdits.some((e) => e.allowTl);
    let abs: string;
    try {
      abs = assertPathInsideGameRoot(gameRoot, relFile, { allowTl });
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (!fs.existsSync(abs)) {
      errors.push(`${relFile}: 文件不存在`);
      continue;
    }

    const content = fs.readFileSync(abs, "utf8");
    const nl = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);

    const sorted = [...fileEdits].sort((a, b) => b.line - a.line);
    let wrote = false;

    for (const edit of sorted) {
      const idx = edit.line - 1;
      if (idx < 0 || idx >= lines.length) {
        errors.push(`${relFile}:${edit.line}: 行号超出范围`);
        continue;
      }
      try {
        if (edit.applySpeaker) {
          lines[idx] = rewriteSayLine(
            lines[idx],
            edit.text,
            edit.speaker ?? null,
          );
        } else {
          lines[idx] = replaceQuotedOnLine(lines[idx], edit.text);
        }
        wrote = true;
      } catch (err) {
        errors.push(
          `${relFile}:${edit.line}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (wrote) {
      fs.writeFileSync(abs, lines.join(nl), "utf8");
      updatedFiles.push(relFile);
    }
  }

  return { updatedFiles, errors };
}

const SAY_WITH_SPEAKER =
  /^(\s*)([A-Za-z_][\w.]*)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const SAY_NARRATOR =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const MENU_CHOICE =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(?:#.*)?$/;
const MENU_PROMPT =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;

/** Only say / menu prompt / menu choice — never if / $call / scene / etc. */
export function isEditableDialogueSourceLine(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("$")) {
    return false;
  }
  if (
    /^(if|elif|else|label|jump|call|return|menu|scene|show|hide|play|stop)\b/.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (MENU_CHOICE.test(raw)) return true;
  if (SAY_WITH_SPEAKER.test(raw)) return true;
  if (SAY_NARRATOR.test(raw) || MENU_PROMPT.test(raw)) return true;
  return false;
}

/** A normal say line (not menu choice). */
export function isSaySourceLine(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("$")) {
    return false;
  }
  if (MENU_CHOICE.test(raw)) return false;
  if (SAY_WITH_SPEAKER.test(raw)) {
    const speaker = raw.match(SAY_WITH_SPEAKER)?.[2];
    if (!speaker || speaker.includes(".")) return false;
    return true;
  }
  const narr = raw.match(SAY_NARRATOR);
  if (!narr) return false;
  const after = narr[0].slice(narr[1].length + narr[2].length).trim();
  if (trimmed.endsWith(",")) return false;
  if (after && !after.startsWith("#")) return false;
  return true;
}

/**
 * Whether `lineIdx` (0-based) sits inside a `menu:` block in story script.
 * Mirrors dialogue parser menu tracking (skips python/screen/transform bodies).
 */
export function isInsideMenuBlock(lines: string[], lineIdx: number): boolean {
  let inMenu = false;
  let menuIndent = 0;
  let inPythonBlock = false;
  let pythonIndent = -1;
  let inScreen = false;
  let screenIndent = -1;
  let inSkipBlock = false;
  let skipIndent = -1;

  for (let i = 0; i <= lineIdx && i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (inPythonBlock) {
      if (trimmed && indent <= pythonIndent && !trimmed.startsWith("#")) {
        inPythonBlock = false;
        pythonIndent = -1;
      } else continue;
    }
    if (inScreen) {
      if (trimmed && indent <= screenIndent && !trimmed.startsWith("#")) {
        inScreen = false;
        screenIndent = -1;
      } else continue;
    }
    if (inSkipBlock) {
      if (trimmed && indent <= skipIndent && !trimmed.startsWith("#")) {
        inSkipBlock = false;
        skipIndent = -1;
      } else continue;
    }

    if (/^python\b/.test(trimmed) || /^init\s+python\b/.test(trimmed)) {
      inPythonBlock = true;
      pythonIndent = indent;
      continue;
    }
    if (/^screen\b/.test(trimmed)) {
      inScreen = true;
      screenIndent = indent;
      continue;
    }
    if (/^(transform|style|layeredimage)\b/.test(trimmed)) {
      inSkipBlock = true;
      skipIndent = indent;
      continue;
    }
    if (/^label\s+/.test(trimmed)) {
      inMenu = false;
      continue;
    }
    if (/^menu\s*:/.test(trimmed)) {
      inMenu = true;
      menuIndent = indent;
      continue;
    }
    if (inMenu && trimmed && indent <= menuIndent && !trimmed.startsWith("#")) {
      inMenu = false;
    }
  }

  return inMenu;
}

function readSourceLines(
  gameRoot: string,
  relFile: string,
): { abs: string; nl: string; lines: string[] } {
  const abs = assertPathInsideGameRoot(gameRoot, relFile, { allowTl: false });
  if (!fs.existsSync(abs)) {
    throw new Error("文件不存在");
  }
  const content = fs.readFileSync(abs, "utf8");
  const nl = content.includes("\r\n") ? "\r\n" : "\n";
  return { abs, nl, lines: content.split(/\r?\n/) };
}

export function deleteDialogueLine(
  gameRoot: string,
  relFile: string,
  lineNo: number,
): { file: string; line: number } {
  const { abs, nl, lines } = readSourceLines(gameRoot, relFile);
  const idx = lineNo - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new Error("行号超出范围");
  }
  if (!isEditableDialogueSourceLine(lines[idx])) {
    throw new Error("只能删除对话文本行（say / 菜单标题 / 选项）");
  }
  lines.splice(idx, 1);
  fs.writeFileSync(abs, lines.join(nl), "utf8");
  return { file: relFile, line: lineNo };
}

/**
 * Insert a new empty say line immediately below `afterLine`.
 * Only allowed after a say line that is not inside a menu block.
 * @deprecated Prefer staged save via applyStagedSave; kept for /api/structure.
 */
export function insertDialogueLine(
  gameRoot: string,
  relFile: string,
  afterLine: number,
  speaker: string | null,
  text = "",
): { file: string; sourceLine: number; insertedLine: number } {
  const { abs, nl, lines } = readSourceLines(gameRoot, relFile);
  const idx = afterLine - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new Error("行号超出范围");
  }
  const anchor = lines[idx];
  if (!isSaySourceLine(anchor)) {
    throw new Error("只能在对话 say 行后新增");
  }
  if (isInsideMenuBlock(lines, idx)) {
    throw new Error("menu 块内不能插入对话");
  }
  if (speaker && !/^[A-Za-z_][\w]*$/.test(speaker)) {
    throw new Error("说话人标识无效");
  }

  const indent = anchor.match(/^\s*/)?.[0] ?? "    ";
  const body = `"${escapeForQuotes(text, '"')}"`;
  const newLine = speaker ? `${indent}${speaker} ${body}` : `${indent}${body}`;

  lines.splice(idx + 1, 0, newLine);
  fs.writeFileSync(abs, lines.join(nl), "utf8");
  return { file: relFile, sourceLine: afterLine, insertedLine: afterLine + 1 };
}

function shiftIdsAfter(
  idToIdx: Map<string, number>,
  fromIdx: number,
  delta: number,
) {
  for (const [id, idx] of idToIdx) {
    if (idx >= fromIdx) idToIdx.set(id, idx + delta);
  }
}

function formatSayLine(
  indent: string,
  speaker: string | null,
  text: string,
): string {
  const body = `"${escapeForQuotes(text, '"')}"`;
  if (speaker && speaker.trim()) {
    if (!/^[A-Za-z_][\w]*$/.test(speaker)) {
      throw new Error("说话人标识无效");
    }
    return `${indent}${speaker} ${body}`;
  }
  return `${indent}${body}`;
}

/**
 * Apply chronological structure ops then content rewrites for source files,
 * plus optional tl edits (by absolute line).
 */
export function applyStagedSave(
  gameRoot: string,
  anchors: LineAnchor[],
  structureOps: StagedStructureOp[],
  contents: StagedContent[],
  tlEdits: WriteEdit[],
): { updatedFiles: string[]; errors: string[] } {
  const errors: string[] = [];
  const updatedFiles: string[] = [];

  const files = new Set<string>();
  for (const a of anchors) files.add(a.file);
  for (const op of structureOps) files.add(op.file);
  for (const c of contents) files.add(c.file);

  for (const relFile of files) {
    let abs: string;
    let nl: string;
    let lines: string[];
    try {
      ({ abs, nl, lines } = readSourceLines(gameRoot, relFile));
    } catch (err) {
      errors.push(
        `${relFile}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const idToIdx = new Map<string, number>();
    for (const a of anchors) {
      if (a.file !== relFile) continue;
      if (isPendingId(a.id)) continue;
      const idx = a.line - 1;
      if (idx < 0 || idx >= lines.length) {
        errors.push(`${relFile}: 锚点 ${a.id} 行号无效`);
        continue;
      }
      idToIdx.set(a.id, idx);
    }

    let mutated = false;
    const fileOps = structureOps.filter((o) => o.file === relFile);

    for (const op of fileOps) {
      try {
        if (op.op === "delete") {
          const idx = idToIdx.get(op.id);
          if (idx === undefined) {
            // Already removed pending locally — ignore
            continue;
          }
          const raw = lines[idx];
          if (!isEditableDialogueSourceLine(raw)) {
            throw new Error(`不能删除非对话行（${op.id}）`);
          }
          lines.splice(idx, 1);
          idToIdx.delete(op.id);
          shiftIdsAfter(idToIdx, idx + 1, -1);
          // ids that were > idx: shiftIdsAfter with fromIdx=idx+1 and -1 moves idx+1.. down by 1.
          // Wait: after splice, old idx+1 becomes idx. We need all ids with oldIdx > idx to become oldIdx-1.
          // shiftIdsAfter(fromIdx, -1) does: if idx >= fromIdx then idx += -1.
          // So fromIdx should be idx+1 (old indices strictly greater than deleted idx). Correct.
          mutated = true;
        } else if (op.op === "insert") {
          const afterIdx = idToIdx.get(op.afterId);
          if (afterIdx === undefined) {
            throw new Error(`新增锚点不存在：${op.afterId}`);
          }
          const anchor = lines[afterIdx];
          if (!isSaySourceLine(anchor) && !isPendingId(op.afterId)) {
            // After a pending insert, line is always say we created
            if (!isSaySourceLine(anchor)) {
              throw new Error("只能在对话 say 行后新增");
            }
          }
          if (!isPendingId(op.afterId) && isInsideMenuBlock(lines, afterIdx)) {
            throw new Error("menu 块内不能插入对话");
          }
          const indent = anchor.match(/^\s*/)?.[0] ?? "    ";
          const newLine = formatSayLine(indent, op.speaker, op.text);
          const newIdx = afterIdx + 1;
          lines.splice(newIdx, 0, newLine);
          shiftIdsAfter(idToIdx, newIdx, 1);
          idToIdx.set(op.id, newIdx);
          mutated = true;
        }
      } catch (err) {
        errors.push(
          `${relFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    for (const c of contents) {
      if (c.file !== relFile) continue;
      const idx = idToIdx.get(c.id);
      if (idx === undefined) continue;
      try {
        if (isPendingId(c.id) || c.applySpeaker) {
          lines[idx] = rewriteSayLine(
            lines[idx],
            c.text,
            c.speaker ?? null,
          );
        } else {
          lines[idx] = replaceQuotedOnLine(lines[idx], c.text);
        }
        mutated = true;
      } catch (err) {
        errors.push(
          `${relFile}:${c.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (mutated) {
      fs.writeFileSync(abs, lines.join(nl), "utf8");
      updatedFiles.push(relFile);
    }
  }

  if (tlEdits.length > 0) {
    const tlResult = applyEdits(gameRoot, tlEdits);
    errors.push(...tlResult.errors);
    for (const f of tlResult.updatedFiles) {
      if (!updatedFiles.includes(f)) updatedFiles.push(f);
    }
  }

  return { updatedFiles, errors };
}
