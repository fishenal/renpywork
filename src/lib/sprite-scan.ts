import fs from "fs";
import path from "path";

/** Collect `transform name:` identifiers under game/. */
export function collectSpriteTransforms(gameRoot: string): string[] {
  const names = new Set<string>();
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "tl" || e.name === "cache") continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".rpy")) {
        parseTransformsInFile(full, names);
      }
    }
  }
  walk(gameRoot);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function parseTransformsInFile(abs: string, out: Set<string>) {
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^transform\s+([A-Za-z_][\w]*)\s*:/);
    if (m) out.add(m[1]);
  }
}
