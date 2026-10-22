import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES } from "../project";
import type {
  DialogueLine,
  GraphEdge,
  LabelNode,
  ProjectIndex,
} from "../types";
import { computeReachable } from "./graph";
import { buildTlIndex } from "./tl";

const SAY_WITH_SPEAKER =
  /^(\s*)([A-Za-z_][\w.]*)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const SAY_NARRATOR =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const MENU_CAPTION =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(?:#.*)?$/;
const LABEL_RE = /^label\s+([A-Za-z_][\w.]*)\s*:/;
const JUMP_LITERAL = /^(?:jump|call)\s+([A-Za-z_][\w.]*)\b/;
const JUMP_EXPR = /^(?:jump|call)\s+expression\b/;
const CALL_SCREEN = /^call\s+screen\b/;

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
      continue;
    }

    if (trimmed.startsWith("$")) continue;

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
      const cap = raw.match(MENU_CAPTION);
      if (cap) {
        const text = unescapeQuoted(cap[2]);
        menuCaption = text;
        if (text.length > 0) {
          lines.push(emptyTlFields({
            id: `${relFile}:${lineNo}`,
            file: relFile,
            line: lineNo,
            speaker: null,
            text,
            kind: "menu_caption",
            label: currentLabel,
          }));
        }
        continue;
      }
    }

    const withSpeaker = raw.match(SAY_WITH_SPEAKER);
    if (withSpeaker) {
      const speaker = withSpeaker[2];
      if (NON_SPEAKERS.has(speaker)) continue;
      if (speaker.includes(".")) continue;
      lines.push(emptyTlFields({
        id: `${relFile}:${lineNo}`,
        file: relFile,
        line: lineNo,
        speaker,
        text: unescapeQuoted(withSpeaker[3]),
        kind: "say",
        label: currentLabel,
      }));
      continue;
    }

    if (!inMenu) {
      const narr = raw.match(SAY_NARRATOR);
      if (narr && indent > 0) {
        const after = narr[0].slice(narr[1].length + narr[2].length).trim();
        if (trimmed.endsWith(",")) continue;
        if (after && !after.startsWith("#")) continue;
        lines.push(emptyTlFields({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: unescapeQuoted(narr[2]),
          kind: "say",
          label: currentLabel,
        }));
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
  >,
): DialogueLine {
  return {
    ...base,
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
      const byLine = tl.bySourceLine.get(`${line.file}:${line.line}`);
      const block = byLine ?? tl.byCommentZh.get(line.text);
      if (block) {
        line.textEn = block.textEn;
        line.tlFile = block.tlFile;
        line.tlLine = block.enLine;
        line.tlCommentLine = block.commentLine;
        line.tlCommentZh = block.commentZh;
        line.tlStale = block.commentZh !== line.text;
        paired += 1;
      }
    } else if (line.kind === "menu_caption") {
      const pair = tl.byOldText.get(line.text);
      if (pair) {
        line.textEn = pair.newText;
        line.tlFile = pair.tlFile;
        line.tlLine = pair.newLine;
        line.tlCommentLine = pair.oldLine;
        line.tlCommentZh = pair.oldText;
        line.tlStale = pair.oldText !== line.text;
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

  return {
    gameRoot,
    files,
    lines,
    entryLabel,
    labels,
    edges,
    reachable,
    tlLang: lang,
    tlPairedCount: paired,
  };
}
