import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { ACTION_LABELS } from "@/domain/countries";
import { formatDateTime } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { Approval, Case, RiskAcknowledgment } from "@/domain/types";
import { LightBadge } from "@/components/badges";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { pkr } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await staffPage("preflight.confirm_manager");
  const repo = await getRepo();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [approvals, cases, acks] = await Promise.all([repo.list<Approval>("approvals", [org], { orderBy: "createdAt", desc: true }), repo.list<Case>("cases", [org]), repo.list<RiskAcknowledgment>("riskAcknowledgments", [org])]);
  const pending = approvals.filter((a) => a.kind === "preflight" && a.status === "pending_manager");
  const recent = approvals.filter((a) => a.status !== "pending_manager").slice(0, 25);
  const pendingAcks = acks.filter((a) => a.status === "pending");
  const kase = (id: string) => cases.find((c) => c.id === id);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manager approvals" description="Pre-flights waiting for the second (Manager) confirmation, overrides and student acknowledgments." />
      <Card>
        <CardHeader><CardTitle>Awaiting your confirmation ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {pending.length === 0 ? <EmptyState icon={<CheckSquare />} title="Nothing waiting" /> : (
            <ul className="divide-y">
              {pending.map((a) => {
                const c = kase(a.caseId);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/cases/${a.caseId}/gates`} className="font-medium hover:underline">{c?.studentName} — {ACTION_LABELS[a.action!]}</Link>
                      <div className="text-xs text-muted-foreground">Requested by {a.requestedByName} · {formatDateTime(a.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.payment && <Badge tone={a.payment.refundable ? "amber" : "red"}>{formatMoney(a.payment.amount, a.payment.currency)} · {pkr(a.payment.amountPKR)} {a.payment.refundable ? "refundable" : "NON-REFUNDABLE"}</Badge>}
                      <LightBadge light={c?.light} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Risk acknowledgments awaiting student signature ({pendingAcks.length})</CardTitle></CardHeader>
        <CardContent>
          {pendingAcks.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y">{pendingAcks.map((r) => <li key={r.id} className="py-2 text-sm"><Link href={`/cases/${r.caseId}/gates`} className="hover:underline">{kase(r.caseId)?.studentName}</Link> <span className="text-xs text-muted-foreground">since {formatDateTime(r.createdAt)}</span></li>)}</ul>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent decisions</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><Link href={`/cases/${a.caseId}/gates`} className="hover:underline">{kase(a.caseId)?.studentName ?? a.caseId}</Link> · {a.kind === "override" ? `Override: “${a.reason?.slice(0, 80)}”` : ACTION_LABELS[a.action!]}</span>
                <Badge tone={a.status === "executed" || a.status === "approved" ? "green" : "neutral"}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
