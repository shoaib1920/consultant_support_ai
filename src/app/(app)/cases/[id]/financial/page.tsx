import Link from "next/link";
import { Wrench } from "lucide-react";
import { addDays, formatDate, formatDateTime, todayISO } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import { BalanceChart } from "@/components/balance-chart";
import { SeverityBadge } from "@/components/badges";
import { AnalyzeDocForm, ManualStatementForm } from "@/components/statement-forms";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";

export const metadata = { title: "Financial analyzer" };

export default async function FinancialPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const b = await loadCaseBundle(await getRepo(), actor.organizationId, id);
  const f = b.financial;
  const statements = b.documents.filter((d) => d.docType === "bank_statement" && d.reviewStatus !== "rejected").map((d) => ({ id: d.id, name: d.fileName }));
  const appDate = b.kase.plannedVisaApplicationDate ?? addDays(todayISO(), 7);
  const run = can(actor.role, "analysis.run");

  return (
    <div className="flex flex-col gap-4">
      {!f ? (
        <EmptyState title="No financial analysis yet">Upload a bank statement on the Documents tab, then analyse it below — or enter it manually.</EmptyState>
      ) : (
        <>
          <Alert tone={f.passes ? "green" : "red"} title={f.passes ? "Funds test passes" : "Funds test FAILS"}>
            <span className="text-xs">Analysed {formatDateTime(f.createdAt)} · input: {f.inputMode} · {f.accountHolder} · {f.bankName}</span>
          </Alert>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Required (${f.requirement.currency})`} value={formatMoney(f.requirement.total, f.requirement.currency)} sub={f.fx ? `= ${formatMoney(f.requiredInStatementCurrency, f.statementCurrency)} at ${f.fx.rate} (${formatDate(f.fx.date)})` : undefined} />
            <Stat label="Lowest balance in window" value={f.lowestBalance ? formatMoney(f.lowestBalance.amount, f.statementCurrency) : "—"} sub={f.lowestBalance ? formatDate(f.lowestBalance.date) : undefined} tone={f.lowestBalance && f.lowestBalance.amount < f.requiredInStatementCurrency ? "red" : "green"} />
            <Stat label="Holding window" value={f.window ? `${f.window.days} days` : "—"} sub={f.window ? `${formatDate(f.window.start)} → ${formatDate(f.window.end)}` : undefined} />
            <Stat label="Statement age at application" value={`${f.statementAgeDays} days`} sub={`Application date ${formatDate(f.applicationDate)}`} />
          </div>
          {f.firstFailure && (
            <Alert tone="red" title={`Fails on day ${f.firstFailure.dayIndex}: ${formatDate(f.firstFailure.date)}`}>
              Balance {formatMoney(f.firstFailure.balance, f.statementCurrency)} vs required {formatMoney(f.requiredInStatementCurrency, f.statementCurrency)} — shortfall <strong>{formatMoney(f.firstFailure.shortfall, f.statementCurrency)}</strong>.
              {f.earliestCompliantApplicationDate && <> Earliest compliant application date after rebuilding: <strong>{formatDate(f.earliestCompliantApplicationDate)}</strong>.</>}
            </Alert>
          )}
          <Card>
            <CardHeader><CardTitle>Daily balance</CardTitle></CardHeader>
            <CardContent><BalanceChart daily={f.dailyBalances} required={f.requiredInStatementCurrency} window={f.window} currency={f.statementCurrency} failDate={f.firstFailure?.date} /></CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Requirement formula</CardTitle>
                <CardDescription>Every line comes from the Rules table.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <tbody>
                    {f.requirement.lines.map((l) => (
                      <tr key={l.label}><Td className="text-xs">{l.label}{l.ruleId && <Link href={`/rules?focus=${l.ruleId}`} className="ml-1 text-[11px] text-primary underline">{l.ruleKey}</Link>}</Td><Td className="text-right tabular-nums">{formatMoney(l.amount, l.currency)}</Td></tr>
                    ))}
                    <tr><Td className="font-semibold">Total</Td><Td className="text-right font-semibold tabular-nums">{formatMoney(f.requirement.total, f.requirement.currency)}</Td></tr>
                  </tbody>
                </Table>
                {f.requirement.notes.map((n) => <p key={n} className="mt-2 text-xs text-amber">{n}</p>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="size-4" /> Fix this</CardTitle></CardHeader>
              <CardContent>
                {f.fixActions.length ? <ol className="list-decimal space-y-1.5 pl-4 text-sm">{f.fixActions.map((x) => <li key={x}>{x}</li>)}</ol> : <p className="text-sm text-muted-foreground">No action needed.</p>}
                <p className="mt-3 text-[11px] text-muted-foreground">VisaGuard never helps create, alter or disguise funds or documents. Fixes must be genuine.</p>
              </CardContent>
            </Card>
          </div>
          {(f.problems.length > 0 || f.largeDeposits.length > 0) && (
            <Card>
              <CardHeader><CardTitle>Findings</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-1.5">{f.problems.map((p) => <li key={p.code + p.message} className="flex items-start gap-2 text-sm"><SeverityBadge severity={p.severity} /> <span>{p.message}</span></li>)}</ul>
                {f.largeDeposits.length > 0 && (
                  <Table>
                    <thead><tr><Th>Date</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th className="text-right">× prior avg</Th><Th>Source evidence</Th></tr></thead>
                    <tbody>{f.largeDeposits.map((d) => <tr key={d.date + d.amount}><Td>{formatDate(d.date)}</Td><Td>{d.description}</Td><Td className="text-right tabular-nums">{formatMoney(d.amount, f.statementCurrency)}</Td><Td className="text-right tabular-nums">{d.ratioToPriorAverage}</Td><Td>{d.explained ? <Badge tone="green">{d.explanation}</Badge> : <Badge tone="red">NEEDS MANUAL VERIFICATION</Badge>}</Td></tr>)}</tbody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
      {run && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Analyse an uploaded statement</CardTitle><CardDescription>Uses transactions extracted by the AI (or mock). Check them on the Documents tab first.</CardDescription></CardHeader>
            <CardContent>{statements.length ? <AnalyzeDocForm caseId={id} docs={statements} defaultDate={appDate} /> : <p className="text-sm text-muted-foreground">No bank statement uploaded.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Manual entry (fallback)</CardTitle><CardDescription>For statements the AI cannot read.</CardDescription></CardHeader>
            <CardContent><ManualStatementForm caseId={id} defaultDate={appDate} /></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
