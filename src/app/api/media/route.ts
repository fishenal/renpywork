import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { loadActiveProject } from "@/lib/project";
import { isSafeGameRelativePath } from "@/lib/parse/assets";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export async function GET(req: NextRequest) {
  const session = loadActiveProject();
  if (!session) {
    return NextResponse.json({ error: "尚未打开项目" }, { status: 400 });
  }

  const rel = req.nextUrl.searchParams.get("path") || "";
  if (!isSafeGameRelativePath(rel)) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }

  const abs = path.resolve(session.gameRoot, rel);
  const root = path.resolve(session.gameRoot);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return NextResponse.json({ error: "路径越界" }, { status: 400 });
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const buf = fs.readFileSync(abs);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=60",
    },
  });
}
