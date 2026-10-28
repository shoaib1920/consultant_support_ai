import { NextResponse, type NextRequest } from "next/server";
import type { Organization } from "@/domain/types";
import { can } from "@/server/auth/rbac";
import { SESSION_COOKIE, actorFromToken } from "@/server/auth/session";
import { getRepo } from "@/server/db";
import { NotFoundError, loadCaseBundle } from "@/server/services/bundle";
import { buildReport, reportPdf } from "@/server/services/report";
import { audit } from "@/server/services/audit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor || !can(actor.role, "case.read")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const repo = await getRepo();
  try {
    const b = await loadCaseBundle(repo, actor.organizationId, id);
    const org = await repo.get<Organization>("organizations", actor.organizationId);
    const pdf = await reportPdf(buildReport(b), org?.name ?? "VisaGuard");
    await repo.transaction((tx) => audit(tx, actor, { action: "report.exported", entity: "cases", entityId: id, caseId: id }));
    const name = `refusal-risk-report-${b.kase.studentName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
