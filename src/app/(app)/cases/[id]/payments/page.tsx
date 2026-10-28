import { formatDate } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { User } from "@/domain/types";
import { PaymentRowActions, RefundablePaymentForm } from "@/components/case-edit-forms";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";
import { signedUrl } from "@/server/storage";
import { pkr } from "@/lib/utils";

export const metadata = { title: "Payments" };

export default async function CasePayments({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const repo = await getRepo();
  const b = await loadCaseBundle(repo, actor.organizationId, id);
  const users = await repo.list<User>("users", [["organizationId", "==", actor.organizationId]]);
  const name = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;
  const live = b.payments.filter((p) => p.status !== "void");
  const nonRef = live.filter((p) => !p.refundable && p.status !== "refunded").reduce((a, p) => a + p.amountPKR, 0);
  const risky = b.kase.light === "RED" || (b.kase.criticalFlags ?? 0) > 0;
  const receipts = Object.fromEntries(await Promise.all(b.payments.filter((p) => p.receiptPath).map(async (p) => [p.id, await signedUrl(p.receiptPath!, "application/pdf", "receipt")] as const)));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total recorded" value={pkr(live.reduce((a, p) => a + p.amountPKR, 0))} />
        <Stat label="Non-refundable" value={pkr(nonRef)} tone={nonRef ? "amber" : undefined} />
        <Stat label="Exposed in unresolved risk" value={pkr(risky ? nonRef : 0)} tone={risky && nonRef ? "red" : undefined} sub={risky ? "Case is RED / has critical flags" : "Case has no unresolved critical risk"} />
      </div>
      <Alert tone="blue">Non-refundable payments can only be created through <strong>Gates &amp; pre-flight</strong> (Officer + Manager). This form records refundable payments only.</Alert>
      {can(actor.role, "payment.record") && (
        <Card>
          <CardHeader><CardTitle>Record a refundable payment</CardTitle></CardHeader>
          <CardContent><RefundablePaymentForm caseId={id} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Ledger</CardTitle><CardDescription>Amounts converted to PKR at the stored rule rate at the time of authorisation.</CardDescription></CardHeader>
        <CardContent>
          {b.payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th className="text-right">PKR</Th><Th>Refundable</Th><Th>Status</Th><Th>Authorised by</Th><Th>Receipt</Th><Th></Th></tr></thead>
              <tbody>
                {b.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(p.authorizedAt)}</Td>
                    <Td className="text-xs">{p.type.replace(/_/g, " ")}<div className="text-muted-foreground">{p.description}</div></Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</Td>
                    <Td className="text-right tabular-nums">{pkr(p.amountPKR)}</Td>
                    <Td>{p.refundable ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</Td>
                    <Td><Badge>{p.status}</Badge></Td>
                    <Td className="text-xs">{p.authorizedBy.map(name).join(" + ")}{p.approvalId && <div className="text-muted-foreground">via pre-flight</div>}</Td>
                    <Td className="text-xs">{receipts[p.id] ? <a className="text-primary underline" href={receipts[p.id]} target="_blank" rel="noopener noreferrer">View</a> : "—"}</Td>
                    <Td>{can(actor.role, "payment.record") && p.status !== "void" && <PaymentRowActions caseId={id} paymentId={p.id} refundable={p.refundable} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
