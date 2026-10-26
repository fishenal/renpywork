import { NextRequest, NextResponse } from "next/server";
import { loadActiveProject } from "@/lib/project";
import { deleteDialogueLine, insertDialogueLine } from "@/lib/writeback";

export const runtime = "nodejs";

type StructureBody = {
  op?: "delete" | "insert";
  file?: string;
  line?: number;
  /** For insert: speaker id or null/omit for narrator */
  speaker?: string | null;
  /** For insert: dialogue text (default empty) */
  text?: string;
};

export async function POST(req: NextRequest) {
  const session = loadActiveProject();
  if (!session) {
    return NextResponse.json({ error: "尚未打开项目" }, { status: 400 });
  }

  const body = (await req.json()) as StructureBody;
  if (
    (body.op !== "delete" && body.op !== "insert") ||
    typeof body.file !== "string" ||
    typeof body.line !== "number"
  ) {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  try {
    if (body.op === "delete") {
      const result = deleteDialogueLine(
        session.gameRoot,
        body.file,
        body.line,
      );
      return NextResponse.json({ ok: true, op: "delete", ...result });
    }

    const speaker =
      typeof body.speaker === "string" && body.speaker.trim()
        ? body.speaker.trim()
        : null;
    const text = typeof body.text === "string" ? body.text : "";

    const result = insertDialogueLine(
      session.gameRoot,
      body.file,
      body.line,
      speaker,
      text,
    );
    return NextResponse.json({ ok: true, op: "insert", ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 400 },
    );
  }
}
