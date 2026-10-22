import { NextRequest, NextResponse } from "next/server";
import { loadActiveProject } from "@/lib/project";
import { applyEdits } from "@/lib/writeback";
import type { WriteEdit } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  const session = loadActiveProject();
  if (!session) {
    return NextResponse.json({ error: "尚未打开项目" }, { status: 400 });
  }

  const body = (await req.json()) as { edits?: WriteEdit[] };
  if (!Array.isArray(body.edits) || body.edits.length === 0) {
    return NextResponse.json({ error: "没有要保存的修改" }, { status: 400 });
  }

  for (const edit of body.edits) {
    if (
      typeof edit.file !== "string" ||
      typeof edit.line !== "number" ||
      typeof edit.text !== "string"
    ) {
      return NextResponse.json({ error: "edits 格式无效" }, { status: 400 });
    }
  }

  const result = applyEdits(session.gameRoot, body.edits);
  if (result.errors.length && result.updatedFiles.length === 0) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
