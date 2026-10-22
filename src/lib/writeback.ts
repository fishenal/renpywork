import fs from "fs";
import { assertPathInsideGameRoot } from "./project";
import type { WriteEdit } from "./types";

function escapeForQuotes(text: string, quote: '"' | "'"): string {
  if (quote === '"') {
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Replace the first quoted string on a line with new text, preserving
 * indentation, speaker, trailing colon (menu), and comments.
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
    let abs: string;
    try {
      abs = assertPathInsideGameRoot(gameRoot, relFile);
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

    // Apply higher line numbers first so indices stay valid (we're editing by absolute line number)
    const sorted = [...fileEdits].sort((a, b) => b.line - a.line);
    let fileOk = true;

    for (const edit of sorted) {
      const idx = edit.line - 1;
      if (idx < 0 || idx >= lines.length) {
        errors.push(`${relFile}:${edit.line}: 行号超出范围`);
        fileOk = false;
        continue;
      }
      try {
        lines[idx] = replaceQuotedOnLine(lines[idx], edit.text);
      } catch (err) {
        errors.push(
          `${relFile}:${edit.line}: ${err instanceof Error ? err.message : String(err)}`,
        );
        fileOk = false;
      }
    }

    if (fileOk || sorted.length > 0) {
      // Write even partial success for lines that applied; only skip if nothing changed
      fs.writeFileSync(abs, lines.join(nl), "utf8");
      updatedFiles.push(relFile);
    }
  }

  return { updatedFiles, errors };
}
