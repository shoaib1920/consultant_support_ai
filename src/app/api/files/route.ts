// Serves a stored file for a short-lived signed token (MOCK storage). Also requires a session in the
// same organisation; students may only fetch their own files.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, actorFromToken } from "@/server/auth/session";
import { getFile, verifyFileToken } from "@/server/storage";

export async function GET(req: NextRequest) {
  const tok = verifyFileToken(req.nextUrl.searchParams.get("t") ?? "");
  if (!tok) return new NextResponse("Link expired or invalid", { status: 403 });
  const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor || !tok.p.startsWith(`orgs/${actor.organizationId}/`)) return new NextResponse("Forbidden", { status: 403 });
  if (actor.role === "student" && !tok.p.includes(`/students/${actor.studentId}/`)) return new NextResponse("Forbidden", { status: 403 });
  const data = await getFile(tok.p);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": tok.m, "Content-Disposition": `inline; filename="${tok.n.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
