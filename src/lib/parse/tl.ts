import fs from "fs";
import path from "path";

export type TlSayBlock = {
  sourceFile: string; // relative to game/, e.g. scenes/01.prologue.rpy
  sourceLine: number;
  tlFile: string; // relative to game/, e.g. tl/english/scenes/01.prologue.rpy
  commentLine: number;
  commentZh: string;
  enLine: number;
  textEn: string;
  speaker: string | null;
};

export type TlStringPair = {
  tlFile: string;
  oldLine: number;
  newLine: number;
  oldText: string;
  newText: string;
};

const HASH_REF = /^#\s*game\/(.+\.rpy):(\d+)\s*$/;
const COMMENT_SAY =
  /^(\s*)#\s*([A-Za-z_][\w.]*)?\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*$/;
const COMMENT_SAY_NARR =
  /^(\s*)#\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*$/;
const LIVE_SAY =
  /^(\s*)([A-Za-z_][\w.]*)?\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const OLD_RE =
  /^(\s*)old\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
const NEW_RE =
  /^(\s*)new\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;

function unescapeQuoted(quoted: string): string {
  const q = quoted[0];
  const inner = quoted.slice(1, -1);
  if (q === '"') {
    return inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return inner.replace(/\\'/g, "'").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function collectTlFiles(gameRoot: string, lang: string): string[] {
  const root = path.join(gameRoot, "tl", lang);
  if (!fs.existsSync(root)) return [];
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
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".rpy")) {
        results.push(path.relative(gameRoot, full).split(path.sep).join("/"));
      }
    }
  }

  walk(root);
  return results.sort();
}

function parseTlFile(
  gameRoot: string,
  relFile: string,
): { says: TlSayBlock[]; strings: TlStringPair[] } {
  const abs = path.join(gameRoot, relFile);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return { says: [], strings: [] };
  }

  const raw = content.split(/\r?\n/);
  const says: TlSayBlock[] = [];
  const strings: TlStringPair[] = [];

  let pendingSource: { file: string; line: number } | null = null;
  let pendingComment: {
    line: number;
    zh: string;
    speaker: string | null;
  } | null = null;
  let pendingOld: { line: number; text: string } | null = null;

  for (let i = 0; i < raw.length; i++) {
    const lineNo = i + 1;
    const trimmed = raw[i].trim();

    const href = trimmed.match(HASH_REF);
    if (href) {
      pendingSource = { file: href[1], line: Number(href[2]) };
      pendingComment = null;
      continue;
    }

    if (/^translate\s+\w+\s+strings\s*:/.test(trimmed)) {
      pendingSource = null;
      pendingComment = null;
      continue;
    }

    if (/^translate\s+\w+\s+\S+:/.test(trimmed)) {
      pendingComment = null;
      continue;
    }

    const oldM = raw[i].match(OLD_RE);
    if (oldM) {
      pendingOld = { line: lineNo, text: unescapeQuoted(oldM[2]) };
      continue;
    }

    const newM = raw[i].match(NEW_RE);
    if (newM && pendingOld) {
      strings.push({
        tlFile: relFile,
        oldLine: pendingOld.line,
        newLine: lineNo,
        oldText: pendingOld.text,
        newText: unescapeQuoted(newM[2]),
      });
      pendingOld = null;
      continue;
    }

    // Comment say inside translate block
    const cSpeak = raw[i].match(COMMENT_SAY);
    if (cSpeak && trimmed.startsWith("#")) {
      const speaker = cSpeak[2] || null;
      const zh = unescapeQuoted(cSpeak[3]);
      pendingComment = { line: lineNo, zh, speaker };
      continue;
    }
    const cNarr = raw[i].match(COMMENT_SAY_NARR);
    if (cNarr && trimmed.startsWith("#") && !cSpeak) {
      pendingComment = {
        line: lineNo,
        zh: unescapeQuoted(cNarr[2]),
        speaker: null,
      };
      continue;
    }

    // Live English say line after comment
    if (pendingComment && pendingSource && !trimmed.startsWith("#")) {
      const live = raw[i].match(LIVE_SAY);
      if (live && live[3]) {
        const speaker = live[2] || pendingComment.speaker;
        says.push({
          sourceFile: pendingSource.file,
          sourceLine: pendingSource.line,
          tlFile: relFile,
          commentLine: pendingComment.line,
          commentZh: pendingComment.zh,
          enLine: lineNo,
          textEn: unescapeQuoted(live[3]),
          speaker,
        });
        pendingComment = null;
        pendingSource = null;
      }
    }
  }

  return { says, strings };
}

export type TlIndex = {
  /** key: `${sourceFile}:${sourceLine}` */
  bySourceLine: Map<string, TlSayBlock>;
  /** key: commentZh (first wins) for say fallback */
  byCommentZh: Map<string, TlSayBlock>;
  /** key: old Chinese string for menu/UI */
  byOldText: Map<string, TlStringPair>;
  lang: string;
};

export function buildTlIndex(gameRoot: string, lang = "english"): TlIndex {
  const bySourceLine = new Map<string, TlSayBlock>();
  const byCommentZh = new Map<string, TlSayBlock>();
  const byOldText = new Map<string, TlStringPair>();

  for (const file of collectTlFiles(gameRoot, lang)) {
    const { says, strings } = parseTlFile(gameRoot, file);
    for (const s of says) {
      const key = `${s.sourceFile}:${s.sourceLine}`;
      if (!bySourceLine.has(key)) bySourceLine.set(key, s);
      if (!byCommentZh.has(s.commentZh)) byCommentZh.set(s.commentZh, s);
    }
    for (const p of strings) {
      if (!byOldText.has(p.oldText)) byOldText.set(p.oldText, p);
    }
  }

  return { bySourceLine, byCommentZh, byOldText, lang };
}
