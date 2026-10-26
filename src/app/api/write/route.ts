import { NextRequest, NextResponse } from "next/server";
import { loadActiveProject } from "@/lib/project";
import { applyEdits, applyStagedSave } from "@/lib/writeback";
import type { StagedSaveBody, WriteEdit } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  const session = loadActiveProject();
  if (!session) {
    return NextResponse.json({ error: "尚未打开项目" }, { status: 400 });
  }

  const body = (await req.json()) as StagedSaveBody & { edits?: WriteEdit[] };

  // New staged save (structure + contents + tl)
  if (
    Array.isArray(body.structureOps) ||
    Array.isArray(body.contents) ||
    Array.isArray(body.anchors)
  ) {
    const anchors = body.anchors ?? [];
    const structureOps = body.structureOps ?? [];
    const contents = body.contents ?? [];
    const tlEdits = body.tlEdits ?? [];

    if (
      structureOps.length === 0 &&
      contents.length === 0 &&
      tlEdits.length === 0
    ) {
      return NextResponse.json({ error: "没有要保存的修改" }, { status: 400 });
    }

    const result = applyStagedSave(
      session.gameRoot,
      anchors,
      structureOps,
      contents,
      tlEdits,
    );
    if (result.errors.length && result.updatedFiles.length === 0) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  // Legacy: edits-only
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
