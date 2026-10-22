import { NextResponse } from "next/server";
import {
  getDefaultGameRoot,
  loadActiveProject,
  resolveGameRoot,
  saveActiveProject,
} from "@/lib/project";

export const runtime = "nodejs";

export async function GET() {
  let session = loadActiveProject();

  if (!session) {
    const fallback = getDefaultGameRoot();
    if (fallback) {
      const resolved = resolveGameRoot(fallback);
      if (resolved.ok) {
        saveActiveProject(resolved.session);
        session = resolved.session;
      }
    }
  }

  return NextResponse.json({ session });
}
