import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, actorFromToken } from "@/server/auth/session";
import { AuthError } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { NotFoundError } from "@/server/services/bundle";
import { exportStudentData } from "@/server/services/students";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const data = await exportStudentData(await getRepo(), actor, id);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="student-${id}-export.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return new NextResponse(e.message, { status: e.status });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
