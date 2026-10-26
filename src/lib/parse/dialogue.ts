import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES } from "../project";
import type {
  CharacterRef,
  DialogueLine,
  GraphEdge,
  LabelNode,
  ProjectIndex,
} from "../types";
import { scanAssets } from "./assets";
import { computeReachable } from "./graph";
import {
  bgTransforms,
  buildAudioOptions,
  buildBackgroundOptions,
  defaultFadeins,
} from "../media";
import { collectSpriteTransforms } from "../sprite-scan";
import {
  buildSpriteCatalog,
  defaultTransitions,
  spritePositionTransforms,
} from "../sprite";
import { buildTlIndex } from "./tl";

const SAY_WITH_SPEAKER =
  /^(\s*)([A-Za-z_][\w.]*)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const SAY_NARRATOR =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
/** Menu choice: `"text":` — colon required */
const MENU_CHOICE =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(?:#.*)?$/;
/** Menu prompt/title: `"text"` with no trailing colon (Ren'Py set_caption) */
const MENU_PROMPT =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const LABEL_RE = /^label\s+([A-Za-z_][\w.]*)\s*:/;
const JUMP_LITERAL = /^(?:jump|call)\s+([A-Za-z_][\w.]*)\b/;
const JUMP_EXPR = /^(?:jump|call)\s+expression\b/;
const CALL_SCREEN = /^call\s+screen\b/;
const IF_ELIF_RE = /^(if|elif)\s+(.+?)\s*:\s*(?:#.*)?$/;
const ELSE_RE = /^else\s*:\s*(?:#.*)?$/;
const SCENE_RE = /^scene\s+(.+?)\s*(?:#.*)?$/;
const SHOW_RE = /^show\s+(.+?)\s*(?:#.*)?$/;
const HIDE_RE = /^hide\s+(.+?)\s*(?:#.*)?$/;
const PLAY_RE = /^play\s+(music|sound|ambient)\s+(.+?)\s*(?:#.*)?$/;
/** `$ name(...)` — generic one-liner Python call (not assignment) */
const DOLLAR_CALL_HEAD = /^\$\s*([A-Za-z_][\w.]*)\s*\(/;

function extractCallArgs(afterOpenParen: string): string | null {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < afterOpenParen.length; i++) {
    const ch = afterOpenParen[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && (inSingle || inDouble)) {
      escape = true;
      continue;
    }
    if (!inDouble && ch === "'" && !inSingle) {
      inSingle = true;
      continue;
    }
    if (inSingle && ch === "'") {
      inSingle = false;
      continue;
    }
    if (!inSingle && ch === '"' && !inDouble) {
      inDouble = true;
      continue;
    }
    if (inDouble && ch === '"') {
      inDouble = false;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return afterOpenParen.slice(0, i).trim();
    }
  }
  return null;
}

const KEYWORDS = new Set([
  "label",
  "jump",
  "call",
  "return",
  "menu",
  "if",
  "elif",
  "else",
  "while",
  "python",
  "init",
  "define",
  "default",
  "image",
  "scene",
  "show",
  "hide",
  "with",
  "play",
  "stop",
  "queue",
  "pause",
  "window",
  "nvl",
  "voice",
  "screen",
  "transform",
  "style",
  "layeredimage",
  "translate",
  "early",
  "and",
  "or",
  "not",
  "True",
  "False",
  "None",
]);

const NON_SPEAKERS = new Set([
  ...KEYWORDS,
  "text",
  "textbutton",
  "text_style",
  "text_align",
  "text_size",
  "text_color",
  "idle_background",
  "hover_background",
  "selected_idle_background",
  "selected_hover_background",
  "insensitive_background",
  "background",
  "foreground",
  "hover",
  "idle",
  "selected",
  "insensitive",
  "focus",
  "tooltip",
  "action",
  "clicked",
  "hovered",
  "unhovered",
  "alternate",
  "style_prefix",
  "style_suffix",
  "style_group",
  "at",
  "as",
  "xpos",
  "ypos",
  "xalign",
  "yalign",
  "xanchor",
  "yanchor",
  "xoffset",
  "yoffset",
  "xmaximum",
  "ymaximum",
  "xminimum",
  "yminimum",
  "xsize",
  "ysize",
  "xfill",
  "yfill",
  "spacing",
  "padding",
  "color",
  "size",
  "font",
  "bold",
  "italic",
  "drag",
  "drop",
  "key",
  "timer",
  "input",
  "bar",
  "vbar",
  "viewport",
  "side",
  "fixed",
  "frame",
  "window",
  "button",
  "imagebutton",
  "add",
  "has",
  "use",
  "on",
  "modal",
  "zorder",
  "tag",
  "layer",
  "mouse",
  "keyboard",
  "focus_mask",
  "activate_sound",
  "hover_sound",
  "selected_sound",
]);

function unescapeQuoted(quoted: string): string {
  const q = quoted[0];
  const inner = quoted.slice(1, -1);
  if (q === '"') {
    return inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return inner.replace(/\\'/g, "'").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function collectRpyFiles(gameRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".rpy")) {
        results.push(path.relative(gameRoot, full).split(path.sep).join("/"));
      }
    }
  }

  walk(gameRoot);
  results.sort();
  return results;
}

type FileParseResult = {
  lines: DialogueLine[];
  labels: LabelNode[];
  edges: GraphEdge[];
};

function parseFile(gameRoot: string, relFile: string): FileParseResult {
  const abs = path.join(gameRoot, relFile);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return { lines: [], labels: [], edges: [] };
  }

  const rawLines = content.split(/\r?\n/);
  const lines: DialogueLine[] = [];
  const labels: LabelNode[] = [];
  const edges: GraphEdge[] = [];

  let currentLabel: string | null = null;
  let inMenu = false;
  let menuIndent = 0;
  let menuCaption: string | null = null;
  let inPythonBlock = false;
  let pythonIndent = -1;
  let inScreen = false;
  let screenIndent = -1;
  let inSkipBlock = false;
  let skipIndent = -1;
  /** Open if/elif/else headers by indent (outer → inner) */
  const branchStack: number[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (inPythonBlock) {
      if (trimmed && indent <= pythonIndent && !trimmed.startsWith("#")) {
        inPythonBlock = false;
        pythonIndent = -1;
      } else {
        continue;
      }
    }

    if (inScreen) {
      if (trimmed && indent <= screenIndent && !trimmed.startsWith("#")) {
        inScreen = false;
        screenIndent = -1;
      } else {
        continue;
      }
    }

    if (inSkipBlock) {
      if (trimmed && indent <= skipIndent && !trimmed.startsWith("#")) {
        inSkipBlock = false;
        skipIndent = -1;
      } else {
        continue;
      }
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

    const labelMatch = trimmed.match(LABEL_RE);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      labels.push({
        id: currentLabel,
        file: relFile,
        line: lineNo,
        kind: "label",
      });
      inMenu = false;
      menuCaption = null;
      branchStack.length = 0;
      continue;
    }

    // Generic `$ method(...)` — show name + args; skip assignments like `$ x = 1`
    if (trimmed.startsWith("$")) {
      const head = trimmed.match(DOLLAR_CALL_HEAD);
      if (head) {
        const name = head[1];
        const after = trimmed.slice(head[0].length);
        const args = extractCallArgs(after);
        if (args !== null) {
          // branch stack may still apply for indent context
          while (
            branchStack.length > 0 &&
            indent < branchStack[branchStack.length - 1]
          ) {
            branchStack.pop();
          }
          lines.push(
            emptyTlFields({
              id: `${relFile}:${lineNo}`,
              file: relFile,
              line: lineNo,
              speaker: null,
              text: args,
              kind: "py_call",
              label: currentLabel,
              branchDepth: branchStack.length,
              callName: name,
              callArgs: args,
            }),
          );
        }
      }
      continue;
    }

    // Close finished if-blocks when indent goes back out
    while (
      branchStack.length > 0 &&
      indent < branchStack[branchStack.length - 1]
    ) {
      branchStack.pop();
    }

    if (/^menu\s*:/.test(trimmed)) {
      inMenu = true;
      menuIndent = indent;
      menuCaption = null;
      continue;
    }

    if (inMenu) {
      if (trimmed && indent <= menuIndent && !trimmed.startsWith("#")) {
        inMenu = false;
        menuCaption = null;
      }
    }

    // if / elif / else markers (story script only; screens/python already skipped)
    const ifElif = trimmed.match(IF_ELIF_RE);
    const isElse = ELSE_RE.test(trimmed);
    if (ifElif || isElse) {
      const kind = (ifElif ? ifElif[1] : "else") as "if" | "elif" | "else";
      const condition = ifElif ? ifElif[2].trim() : "";

      if (kind === "if") {
        branchStack.push(indent);
      } else if (
        branchStack.length > 0 &&
        indent === branchStack[branchStack.length - 1]
      ) {
        // elif/else continues the same if-chain; depth unchanged
      } else if (kind === "elif" || kind === "else") {
        // Orphan elif/else — still show, treat as new depth
        branchStack.push(indent);
      }

      const depth = Math.max(0, branchStack.length - 1);
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: condition,
          kind,
          label: currentLabel,
          branchDepth: depth,
        }),
      );
      continue;
    }

    const branchDepth = branchStack.length;

    // Literal scene / show / hide / play (display-only timeline markers)
    const playM = trimmed.match(PLAY_RE);
    if (playM) {
      const channel = playM[1] as "music" | "sound" | "ambient";
      const kind =
        channel === "music"
          ? "play_music"
          : channel === "sound"
            ? "play_sound"
            : "play_ambient";
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: playM[2].trim(),
          kind,
          label: currentLabel,
          branchDepth,
        }),
      );
      continue;
    }

    const sceneM = trimmed.match(SCENE_RE);
    if (sceneM) {
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: sceneM[1].trim(),
          kind: "scene",
          label: currentLabel,
          branchDepth,
        }),
      );
      continue;
    }

    const showM = trimmed.match(SHOW_RE);
    if (showM) {
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: showM[1].trim(),
          kind: "show",
          label: currentLabel,
          branchDepth,
        }),
      );
      continue;
    }

    const hideM = trimmed.match(HIDE_RE);
    if (hideM) {
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: hideM[1].trim(),
          kind: "hide",
          label: currentLabel,
          branchDepth,
        }),
      );
      continue;
    }

    // Graph edges (only when inside a label)
    if (currentLabel) {
      if (JUMP_EXPR.test(trimmed)) {
        const dynId = `dynamic:${relFile}:${lineNo}`;
        labels.push({
          id: dynId,
          file: relFile,
          line: lineNo,
          kind: "dynamic",
        });
        edges.push({
          from: currentLabel,
          to: dynId,
          kind: "dynamic",
          file: relFile,
          line: lineNo,
        });
      } else if (!CALL_SCREEN.test(trimmed)) {
        const jumpMatch = trimmed.match(JUMP_LITERAL);
        if (jumpMatch) {
          const target = jumpMatch[1];
          const isCall = trimmed.startsWith("call");
          edges.push({
            from: currentLabel,
            to: target,
            kind: inMenu && menuCaption ? "menu" : isCall ? "call" : "jump",
            caption: inMenu ? menuCaption ?? undefined : undefined,
            file: relFile,
            line: lineNo,
          });
        }
      }
    }

    if (inMenu) {
      // Choice `"…":` first — more specific than prompt (which has no colon)
      const choice = raw.match(MENU_CHOICE);
      if (choice) {
        const text = unescapeQuoted(choice[2]);
        if (text.length > 0) {
          lines.push(
            emptyTlFields({
              id: `${relFile}:${lineNo}`,
              file: relFile,
              line: lineNo,
              speaker: null,
              text,
              kind: "menu_choice",
              label: currentLabel,
              branchDepth,
            }),
          );
        }
        continue;
      }

      // Prompt `"…"` (no colon) — shown above choices in Ren'Py menus
      const prompt = raw.match(MENU_PROMPT);
      if (prompt) {
        const text = unescapeQuoted(prompt[2]);
        menuCaption = text;
        if (text.length > 0) {
          lines.push(
            emptyTlFields({
              id: `${relFile}:${lineNo}`,
              file: relFile,
              line: lineNo,
              speaker: null,
              text,
              kind: "menu_caption",
              label: currentLabel,
              branchDepth,
            }),
          );
        }
        continue;
      }
    }

    const withSpeaker = raw.match(SAY_WITH_SPEAKER);
    if (withSpeaker) {
      const speaker = withSpeaker[2];
      if (NON_SPEAKERS.has(speaker)) continue;
      if (speaker.includes(".")) continue;
      lines.push(
        emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker,
          text: unescapeQuoted(withSpeaker[3]),
          kind: "say",
          label: currentLabel,
          branchDepth,
          allowInsertAfter: !inMenu && currentLabel != null,
        }),
      );
      continue;
    }

    if (!inMenu) {
      const narr = raw.match(SAY_NARRATOR);
      if (narr && indent > 0) {
        const after = narr[0].slice(narr[1].length + narr[2].length).trim();
        if (trimmed.endsWith(",")) continue;
        if (after && !after.startsWith("#")) continue;
        lines.push(
          emptyTlFields({
            id: `${relFile}:${lineNo}`,
            file: relFile,
            line: lineNo,
            speaker: null,
            text: unescapeQuoted(narr[2]),
            kind: "say",
            label: currentLabel,
            branchDepth,
            allowInsertAfter: currentLabel != null,
          }),
        );
      }
    }
  }

  return { lines, labels, edges };
}

function emptyTlFields(
  base: Omit<
    DialogueLine,
    | "textEn"
    | "tlFile"
    | "tlLine"
    | "tlCommentLine"
    | "tlCommentZh"
    | "tlStale"
    | "callName"
    | "callArgs"
    | "allowInsertAfter"
  > & {
    branchDepth?: number;
    callName?: string | null;
    callArgs?: string | null;
    allowInsertAfter?: boolean;
  },
): DialogueLine {
  return {
    ...base,
    branchDepth: base.branchDepth ?? 0,
    allowInsertAfter: base.allowInsertAfter ?? false,
    callName: base.callName ?? null,
    callArgs: base.callArgs ?? null,
    textEn: null,
    tlFile: null,
    tlLine: null,
    tlCommentLine: null,
    tlCommentZh: null,
    tlStale: false,
  };
}

function attachTranslations(lines: DialogueLine[], gameRoot: string) {
  const tl = buildTlIndex(gameRoot, "english");
  let paired = 0;

  for (const line of lines) {
    if (line.kind === "say") {
      // Prefer exact Chinese match — line numbers in tl/# comments are often stale.
      const byZh = tl.byCommentZh.get(line.text);
      const byLine = tl.bySourceLine.get(`${line.file}:${line.line}`);
      const block =
        byZh ??
        (byLine && byLine.commentZh === line.text ? byLine : null);
      if (block) {
        line.textEn = block.textEn;
        line.tlFile = block.tlFile;
        line.tlLine = block.enLine;
        line.tlCommentLine = block.commentLine;
        line.tlCommentZh = block.commentZh;
        line.tlStale = false;
        paired += 1;
      }
    } else if (
      line.kind === "menu_caption" ||
      line.kind === "menu_choice"
    ) {
      const pair = tl.byOldText.get(line.text);
      if (pair) {
        line.textEn = pair.newText;
        line.tlFile = pair.tlFile;
        line.tlLine = pair.newLine;
        line.tlCommentLine = pair.oldLine;
        line.tlCommentZh = pair.oldText;
        line.tlStale = false;
        paired += 1;
      }
    }
  }

  return {
    paired,
    lang: tl.bySourceLine.size || tl.byOldText.size ? "english" : null,
  };
}

export function scanProject(gameRoot: string): ProjectIndex {
  const files = collectRpyFiles(gameRoot);
  const lines: DialogueLine[] = [];
  const labels: Record<string, LabelNode> = {};
  const edges: GraphEdge[] = [];

  for (const file of files) {
    const parsed = parseFile(gameRoot, file);
    lines.push(...parsed.lines);
    for (const lab of parsed.labels) {
      // Prefer first real label definition; dynamic ids are unique
      if (!labels[lab.id] || labels[lab.id].kind === "dynamic") {
        labels[lab.id] = lab;
      }
    }
    edges.push(...parsed.edges);
  }

  // Ensure edge targets that are real labels but never defined still appear as stubs
  for (const edge of edges) {
    if (!labels[edge.to] && !edge.to.startsWith("dynamic:")) {
      labels[edge.to] = {
        id: edge.to,
        file: edge.file,
        line: edge.line,
        kind: "label",
      };
    }
  }

  let entryLabel: string | null = null;
  if (labels["start"]) {
    entryLabel = "start";
  } else {
    const first = Object.values(labels).find((l) => l.kind === "label");
    entryLabel = first?.id ?? null;
  }

  const reachable = entryLabel
    ? computeReachable(entryLabel, edges, labels)
    : [];

  const { paired, lang } = attachTranslations(lines, gameRoot);
  const assets = scanAssets(gameRoot);
  const characters = collectCharacters(assets);
  const sprites = buildSpriteCatalog(assets.items);
  const allTransforms = collectSpriteTransforms(gameRoot);
  const transforms = spritePositionTransforms(allTransforms);
  const transitions = defaultTransitions();
  const backgrounds = buildBackgroundOptions(assets.items);
  const bgXforms = bgTransforms(allTransforms);
  const bgm = buildAudioOptions(assets.items, "bgm");
  const ambient = buildAudioOptions(assets.items, "sfx");
  const sfx = buildAudioOptions(assets.items, "snd");
  const fadeins = defaultFadeins();

  return {
    gameRoot,
    files,
    lines,
    entryLabel,
    labels,
    edges,
    reachable,
    characters,
    sprites,
    transforms,
    transitions,
    backgrounds,
    bgTransforms: bgXforms,
    bgm,
    ambient,
    sfx,
    fadeins,
    tlLang: lang,
    tlPairedCount: paired,
  };
}

function collectCharacters(
  assets: ReturnType<typeof scanAssets>,
): CharacterRef[] {
  const byName = new Map<string, CharacterRef>();
  for (const item of assets.items) {
    if (item.kind !== "character") continue;
    if (!byName.has(item.name)) {
      byName.set(item.name, { name: item.name, note: item.note });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
