import Link from "next/link";
import { formatDate } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { Case, Payment } from "@/domain/types";
import { LightBadge } from "@/components/badges";
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { pkr } from "@/lib/utils";

export const metadata = { title: "Payments ledger" };

export default async function PaymentsPage() {
  const actor = await staffPage("case.read");
  const repo = await getRepo();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [payments, cases] = await Promise.all([repo.list<Payment>("payments", [org], { orderBy: "authorizedAt", desc: true }), repo.list<Case>("cases", [org])]);
  const live = payments.filter((p) => p.status !== "void");
  const kase = (id: string) => cases.find((c) => c.id === id);
  const risky = (p: Payment) => {
    const c = kase(p.caseId);
    return !!c && (c.light === "RED" || (c.criticalFlags ?? 0) > 0);
  };
  const nonRef = live.filter((p) => !p.refundable && p.status !== "refunded");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payments ledger" description="Every payment with its refundability and who authorised it. Non-refundable entries exist only via executed pre-flights." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total recorded" value={pkr(live.reduce((a, p) => a + p.amountPKR, 0))} sub={`${live.length} payments`} />
        <Stat label="Non-refundable" value={pkr(nonRef.reduce((a, p) => a + p.amountPKR, 0))} tone="amber" />
        <Stat label="Money exposed in unresolved-risk cases" value={pkr(nonRef.filter(risky).reduce((a, p) => a + p.amountPKR, 0))} tone="red" sub="Non-refundable money on RED / critical-flag cases" />
      </div>
      {payments.length === 0 ? <EmptyState title="No payments yet" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Case</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th className="text-right">PKR</Th><Th>Refundable</Th><Th>Status</Th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={risky(p) && !p.refundable ? "bg-red-soft/40" : ""}>
                  <Td className="whitespace-nowrap text-xs">{formatDate(p.authorizedAt)}</Td>
                  <Td><Link href={`/cases/${p.caseId}/payments`} className="hover:underline">{kase(p.caseId)?.studentName}</Link> <LightBadge light={kase(p.caseId)?.light} /></Td>
                  <Td className="text-xs">{p.type.replace(/_/g, " ")}<div className="text-muted-foreground">{p.description}</div></Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</Td>
                  <Td className="text-right tabular-nums">{pkr(p.amountPKR)}</Td>
                  <Td>{p.refundable ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</Td>
                  <Td><Badge>{p.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
