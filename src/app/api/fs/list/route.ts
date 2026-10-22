import { NextRequest, NextResponse } from "next/server";
import { getHomeDir, listDirectory } from "@/lib/project";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const pathParam = req.nextUrl.searchParams.get("path") || getHomeDir();
  const result = listDirectory(pathParam);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
