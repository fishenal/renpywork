import { NextRequest, NextResponse } from "next/server";
import { resolveGameRoot, saveActiveProject } from "@/lib/project";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { root?: string };
  if (!body.root || typeof body.root !== "string") {
    return NextResponse.json({ error: "缺少 root" }, { status: 400 });
  }

  const resolved = resolveGameRoot(body.root);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  saveActiveProject(resolved.session);
  return NextResponse.json({ session: resolved.session });
}
