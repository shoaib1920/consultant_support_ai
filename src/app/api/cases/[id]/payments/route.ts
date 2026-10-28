// REST: record a payment. Non-refundable payments are refused here; they only exist via pre-flight.
import { NextResponse, type NextRequest } from "next/server";
import { GateError } from "@/domain/gates";
import { AuthError } from "@/server/auth/rbac";
import { SESSION_COOKIE, actorFromToken } from "@/server/auth/session";
import { getRepo } from "@/server/db";
import { PaymentSchema } from "@/server/schemas";
import { NotFoundError } from "@/server/services/bundle";
import { recordRefundablePayment } from "@/server/services/payments";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const actor = await actorFromToken(bearer || req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = PaymentSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment", issues: parsed.error.issues }, { status: 400 });
  const { id } = await params;
  try {
    const p = await recordRefundablePayment(await getRepo(), actor, id, parsed.data);
    return NextResponse.json({ ok: true, id: p.id });
  } catch (e) {
    if (e instanceof GateError) return NextResponse.json({ ok: false, error: e.message, blockers: e.blockers }, { status: 409 });
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
