import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES } from "../project";
import type { DialogueLine, ProjectIndex } from "../types";

const SAY_WITH_SPEAKER =
  /^(\s*)([A-Za-z_][\w.]*)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const SAY_NARRATOR =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const MENU_CAPTION =
  /^(\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(?:#.*)?$/;

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

/** Screen-language / style property names that look like `name "value"`. */
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

function parseFile(gameRoot: string, relFile: string): DialogueLine[] {
  const abs = path.join(gameRoot, relFile);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const out: DialogueLine[] = [];
  let inMenu = false;
  let menuIndent = 0;
  let inPythonBlock = false;
  let pythonIndent = -1;
  let inScreen = false;
  let screenIndent = -1;
  let inSkipBlock = false;
  let skipIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
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

    if (trimmed.startsWith("$")) continue;

    if (/^menu\s*:/.test(trimmed)) {
      inMenu = true;
      menuIndent = indent;
      continue;
    }

    if (inMenu) {
      if (trimmed && indent <= menuIndent && !trimmed.startsWith("#")) {
        inMenu = false;
      }
    }

    if (inMenu) {
      const cap = raw.match(MENU_CAPTION);
      if (cap) {
        const text = unescapeQuoted(cap[2]);
        if (text.length === 0) continue;
        out.push({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text,
          kind: "menu_caption",
        });
        continue;
      }
    }

    const withSpeaker = raw.match(SAY_WITH_SPEAKER);
    if (withSpeaker) {
      const speaker = withSpeaker[2];
      if (NON_SPEAKERS.has(speaker)) continue;
      // Skip dotted attribute chains that aren't characters (e.g. gui.foo)
      if (speaker.includes(".")) continue;
      out.push({
        id: `${relFile}:${lineNo}`,
        file: relFile,
        line: lineNo,
        speaker,
        text: unescapeQuoted(withSpeaker[3]),
        kind: "say",
      });
      continue;
    }

    // Narrator say: indented string-only line, not a dict key / kwarg (no trailing , or = before)
    if (!inMenu) {
      const narr = raw.match(SAY_NARRATOR);
      if (narr && indent > 0) {
        const after = narr[0].slice(narr[1].length + narr[2].length).trim();
        // SAY_NARRATOR already requires end-of-line (optional comment); reject if line has trailing comma (dict/list)
        if (trimmed.endsWith(",")) continue;
        if (after && !after.startsWith("#")) continue;
        out.push({
          id: `${relFile}:${lineNo}`,
          file: relFile,
          line: lineNo,
          speaker: null,
          text: unescapeQuoted(narr[2]),
          kind: "say",
        });
      }
    }
  }

  return out;
}

export function scanProject(gameRoot: string): ProjectIndex {
  const files = collectRpyFiles(gameRoot);
  const lines: DialogueLine[] = [];
  for (const file of files) {
    lines.push(...parseFile(gameRoot, file));
  }
  return { gameRoot, files, lines };
}
