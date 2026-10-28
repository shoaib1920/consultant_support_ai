// REST endpoint for integrations. It goes through the SAME gate service as the UI, so calling it
// directly cannot skip any gate: irreversible stages are refused and the attempt is recorded.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { GateError } from "@/domain/gates";
import { STAGES } from "@/domain/types";
import { AuthError } from "@/server/auth/rbac";
import { SESSION_COOKIE, actorFromToken } from "@/server/auth/session";
import { getRepo } from "@/server/db";
import { NotFoundError } from "@/server/services/bundle";
import { transitionCase } from "@/server/services/gates";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const actor = await actorFromToken(bearer || req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ to: z.enum(STAGES) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { to: <stage> }" }, { status: 400 });
  const { id } = await params;
  try {
    const c = await transitionCase(await getRepo(), actor, id, parsed.data.to);
    return NextResponse.json({ ok: true, stage: c.stage });
  } catch (e) {
    if (e instanceof GateError) return NextResponse.json({ ok: false, error: e.message, blockers: e.blockers }, { status: 409 });
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
