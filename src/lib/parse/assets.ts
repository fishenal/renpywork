import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES } from "../project";

export type AssetKind =
  | "character"
  | "sprite"
  | "bg"
  | "bgm"
  | "sfx"
  | "snd"
  | "other";

export type AssetItem = {
  id: string;
  kind: AssetKind;
  /** Script symbol, e.g. bg bedroom / audio.bgm_soft / lz / pb */
  name: string;
  /** Relative path under game/, if a file is known */
  path: string | null;
  /** Defining .rpy (relative to game/) */
  defFile: string;
  defLine: number;
  /** Trailing ## comment or Character display name */
  note: string | null;
  /** File exists on disk */
  exists: boolean;
  /** Bytes, if exists */
  size: number | null;
};

export type AssetIndex = {
  gameRoot: string;
  items: AssetItem[];
  counts: Record<AssetKind, number>;
};

const IMAGE_RE =
  /^image\s+(.+?)\s*=\s*(.+)$/;
const AUDIO_RE =
  /^define\s+(audio\.\w+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:##\s*(.*))?$/;
const CHARACTER_START =
  /^define\s+(\w+)\s*=\s*(DynamicCharacter|Character)\s*\(/;
const CHARACTER_ALIAS =
  /^define\s+(\w+)\s*=\s*(\w+)\s*(?:##\s*(.*))?$/;
const QUOTED = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;

function unquote(q: string): string {
  const quote = q[0];
  const inner = q.slice(1, -1);
  if (quote === '"') {
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return inner.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function collectRpy(gameRoot: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".rpy")) {
        out.push(path.relative(gameRoot, full).split(path.sep).join("/"));
      }
    }
  }
  walk(gameRoot);
  return out.sort();
}

function classifyImage(name: string, filePath: string | null): AssetKind {
  if (name === "bg" || name.startsWith("bg ")) return "bg";
  if (filePath) {
    const p = filePath.replace(/\\/g, "/").toLowerCase();
    if (p.includes("/scenes/") || p.includes("images/scenes")) return "bg";
    if (p.includes("/characters/") || p.includes("images/characters")) {
      return "sprite";
    }
  }
  return "sprite";
}

function classifyAudio(name: string): AssetKind {
  if (name.startsWith("audio.bgm_")) return "bgm";
  if (name.startsWith("audio.sfx_")) return "sfx";
  if (name.startsWith("audio.snd_")) return "snd";
  return "other";
}

function fileMeta(
  gameRoot: string,
  rel: string | null,
): { exists: boolean; size: number | null } {
  if (!rel) return { exists: false, size: null };
  const abs = path.join(gameRoot, rel);
  try {
    const st = fs.statSync(abs);
    if (st.isFile()) return { exists: true, size: st.size };
  } catch {
    // missing
  }
  return { exists: false, size: null };
}

function parseFile(gameRoot: string, relFile: string): AssetItem[] {
  const abs = path.join(gameRoot, relFile);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const items: AssetItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const lineNo = i + 1;

    const img = trimmed.match(IMAGE_RE);
    if (img) {
      const name = img[1].trim().replace(/\s+/g, " ");
      const rhs = img[2];
      const q = rhs.match(QUOTED);
      const filePath = q ? unquote(q[1]) : null;
      const noteMatch = raw.match(/##\s*(.+)$/);
      const kind = classifyImage(name, filePath);
      const meta = fileMeta(gameRoot, filePath);
      items.push({
        id: `image:${name}:${relFile}:${lineNo}`,
        kind,
        name,
        path: filePath,
        defFile: relFile,
        defLine: lineNo,
        note: noteMatch?.[1]?.trim() ?? null,
        exists: meta.exists,
        size: meta.size,
      });
      continue;
    }

    const audio = trimmed.match(AUDIO_RE);
    if (audio) {
      const name = audio[1];
      const filePath = unquote(audio[2]);
      const note = audio[3]?.trim() || null;
      const meta = fileMeta(gameRoot, filePath);
      items.push({
        id: `audio:${name}:${relFile}:${lineNo}`,
        kind: classifyAudio(name),
        name,
        path: filePath,
        defFile: relFile,
        defLine: lineNo,
        note,
        exists: meta.exists,
        size: meta.size,
      });
      continue;
    }

    // Character / DynamicCharacter (may span lines)
    const chStart = trimmed.match(CHARACTER_START);
    if (chStart) {
      let blob = trimmed;
      let j = i;
      let depth = 0;
      for (let k = 0; k < blob.length; k++) {
        if (blob[k] === "(") depth += 1;
        if (blob[k] === ")") depth -= 1;
      }
      while (depth > 0 && j + 1 < lines.length) {
        j += 1;
        const next = lines[j];
        blob += " " + next.trim();
        for (const c of next) {
          if (c === "(") depth += 1;
          if (c === ")") depth -= 1;
        }
      }
      const name = chStart[1];
      const kindFn = chStart[2];
      const firstArg = blob.match(
        /(?:DynamicCharacter|Character)\s*\(\s*(None|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/,
      );
      let note: string | null = kindFn;
      if (firstArg) {
        if (firstArg[1] === "None") note = "旁白 / None";
        else if (firstArg[2]) note = unquote(firstArg[2]);
      }
      const trail = raw.match(/##\s*(.+)$/);
      if (trail) note = trail[1].trim();

      items.push({
        id: `character:${name}:${relFile}:${lineNo}`,
        kind: "character",
        name,
        path: null,
        defFile: relFile,
        defLine: lineNo,
        note,
        exists: true,
        size: null,
      });
      i = j;
      continue;
    }

    // Alias: define xj2036 = xj036 (only in character definition files)
    if (/character/i.test(relFile)) {
      const alias = trimmed.match(CHARACTER_ALIAS);
      if (
        alias &&
        /^[A-Za-z_][\w]*$/.test(alias[2]) &&
        !/^(True|False|None)$/.test(alias[2])
      ) {
        items.push({
          id: `character:${alias[1]}:${relFile}:${lineNo}`,
          kind: "character",
          name: alias[1],
          path: null,
          defFile: relFile,
          defLine: lineNo,
          note: alias[3]?.trim() || `= ${alias[2]}`,
          exists: true,
          size: null,
        });
      }
    }
  }

  return items;
}

export function scanAssets(gameRoot: string): AssetIndex {
  const files = collectRpy(gameRoot);
  const items: AssetItem[] = [];
  for (const f of files) {
    items.push(...parseFile(gameRoot, f));
  }

  // Prefer stable sort: kind then name
  const kindOrder: AssetKind[] = [
    "character",
    "sprite",
    "bg",
    "bgm",
    "sfx",
    "snd",
    "other",
  ];
  items.sort((a, b) => {
    const ka = kindOrder.indexOf(a.kind);
    const kb = kindOrder.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name);
  });

  const counts = {
    character: 0,
    sprite: 0,
    bg: 0,
    bgm: 0,
    sfx: 0,
    snd: 0,
    other: 0,
  } as Record<AssetKind, number>;
  for (const it of items) counts[it.kind] += 1;

  return { gameRoot, items, counts };
}

export function isSafeGameRelativePath(rel: string): boolean {
  if (!rel || rel.includes("\0")) return false;
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith("/") || norm.includes("..")) return false;
  return true;
}
