import fs from "fs";
import os from "os";
import path from "path";
import type { ProjectSession } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const ACTIVE_PROJECT_FILE = path.join(CACHE_DIR, "active-project.json");

const SKIP_DIR_NAMES = new Set([
  "tl",
  "cache",
  "saves",
  "node_modules",
  ".git",
  "__pycache__",
]);

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function getDefaultGameRoot(): string | null {
  const value = process.env.DEFAULT_GAME_ROOT?.trim();
  return value || null;
}

export function getHomeDir(): string {
  return os.homedir();
}

function dirHasRpy(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".rpy")) return true;
      if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name) && !entry.name.startsWith(".")) {
        // shallow check: common Ren'Py layout has .rpy at game root or one level down
        const nested = path.join(dir, entry.name);
        try {
          const nestedEntries = fs.readdirSync(nested, { withFileTypes: true });
          if (nestedEntries.some((e) => e.isFile() && e.name.endsWith(".rpy"))) {
            return true;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Resolve user-selected path to a gameRoot. */
export function resolveGameRoot(selectedRoot: string): {
  ok: true;
  session: ProjectSession;
} | {
  ok: false;
  error: string;
} {
  const root = path.resolve(selectedRoot);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, error: "路径不存在或不是目录" };
  }

  const asGame = root;
  const nestedGame = path.join(root, "game");

  let gameRoot: string | null = null;

  if (path.basename(asGame) === "game" && dirHasRpy(asGame)) {
    gameRoot = asGame;
  } else if (fs.existsSync(nestedGame) && fs.statSync(nestedGame).isDirectory() && dirHasRpy(nestedGame)) {
    gameRoot = nestedGame;
  } else if (dirHasRpy(asGame) && (fs.existsSync(path.join(asGame, "tl")) || fs.existsSync(path.join(asGame, "script.rpy")) || fs.existsSync(path.join(asGame, "options.rpy")))) {
    gameRoot = asGame;
  } else if (dirHasRpy(asGame)) {
    // Accept any directory that contains .rpy scripts (generic Ren'Py game folder)
    gameRoot = asGame;
  }

  if (!gameRoot) {
    return {
      ok: false,
      error: "不是有效的 Ren'Py 工程（需要含 .rpy 的 game/，或已在 game 目录）",
    };
  }

  const projectRoot =
    path.basename(gameRoot) === "game" ? path.dirname(gameRoot) : gameRoot;

  const displayName = path.basename(projectRoot) || path.basename(gameRoot);

  return {
    ok: true,
    session: {
      root: projectRoot,
      gameRoot,
      displayName,
    },
  };
}

export function saveActiveProject(session: ProjectSession): void {
  ensureCacheDir();
  fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify(session, null, 2), "utf8");
}

export function loadActiveProject(): ProjectSession | null {
  try {
    if (!fs.existsSync(ACTIVE_PROJECT_FILE)) return null;
    const raw = fs.readFileSync(ACTIVE_PROJECT_FILE, "utf8");
    const parsed = JSON.parse(raw) as ProjectSession;
    if (!parsed?.gameRoot || !fs.existsSync(parsed.gameRoot)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveProject(): void {
  try {
    if (fs.existsSync(ACTIVE_PROJECT_FILE)) fs.unlinkSync(ACTIVE_PROJECT_FILE);
  } catch {
    // ignore
  }
}

export function listDirectory(dirPath: string): {
  ok: true;
  path: string;
  parent: string | null;
  entries: {
    name: string;
    path: string;
    isDirectory: boolean;
    looksLikeRenpy: boolean;
  }[];
} | {
  ok: false;
  error: string;
} {
  const resolved = path.resolve(dirPath || getHomeDir());

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { ok: false, error: "目录不存在" };
  }

  let names: string[];
  try {
    names = fs.readdirSync(resolved);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "无法读取目录",
    };
  }

  const parent = path.dirname(resolved) === resolved ? null : path.dirname(resolved);

  const entries = names
    .filter((name) => !name.startsWith("."))
    .map((name) => {
      const full = path.join(resolved, name);
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(full).isDirectory();
      } catch {
        return null;
      }
      if (!isDirectory) return null;

      const looksLikeRenpy =
        (fs.existsSync(path.join(full, "game")) && dirHasRpy(path.join(full, "game"))) ||
        (name === "game" && dirHasRpy(full)) ||
        dirHasRpy(full);

      return {
        name,
        path: full,
        isDirectory: true,
        looksLikeRenpy,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => {
      if (a.looksLikeRenpy !== b.looksLikeRenpy) return a.looksLikeRenpy ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return { ok: true, path: resolved, parent, entries };
}

export function assertPathInsideGameRoot(gameRoot: string, relFile: string): string {
  const abs = path.resolve(gameRoot, relFile);
  const root = path.resolve(gameRoot);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("路径越界：文件必须在当前 game 目录内");
  }
  if (!abs.endsWith(".rpy")) {
    throw new Error("只允许写回 .rpy 文件");
  }
  // block tl/
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel.startsWith("tl/") || rel.includes("/tl/")) {
    throw new Error("本期不允许写回 tl/ 翻译文件");
  }
  return abs;
}

export { SKIP_DIR_NAMES };
