import { NextResponse } from "next/server";
import { loadActiveProject } from "@/lib/project";
import { scanAssets } from "@/lib/parse/assets";

export const runtime = "nodejs";

export async function GET() {
  const session = loadActiveProject();
  if (!session) {
    return NextResponse.json({ error: "尚未打开项目" }, { status: 400 });
  }

  try {
    const index = scanAssets(session.gameRoot);
    return NextResponse.json({ session, index });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "资源扫描失败" },
      { status: 500 },
    );
  }
}
