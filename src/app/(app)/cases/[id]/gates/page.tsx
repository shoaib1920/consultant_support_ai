import { Banknote, CheckCircle2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { ACTION_LABELS } from "@/domain/countries";
import { formatDateTime } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import { IRREVERSIBLE_TRANSITIONS, needsOverride, nextStage, preflightBlockers, riskClearance, transitionBlockers } from "@/domain/gates";
import { RuleContext } from "@/domain/rules";
import type { Approval, GateEvent, IrreversibleAction } from "@/domain/types";
import { STAGES } from "@/domain/types";
import { LightBadge } from "@/components/badges";
import { ConfirmPreflightForm, OverrideForm, PreflightForm, TransitionForm } from "@/components/case-edit-forms";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { gateContext, loadCaseBundle } from "@/server/services/bundle";

export const metadata = { title: "Gates & pre-flight" };

const DEFAULT_TYPE: Record<IrreversibleAction, string> = { pay_fee: "application_fee", submit_application: "application_fee", file_visa: "visa_fee" };

function MoneyAtRisk({ a, eurRate }: { a: Approval; eurRate?: number }) {
  if (!a.payment) return null;
  const p = a.payment;
  const eur = p.currency === "EUR" ? p.amount : eurRate ? p.amountPKR / eurRate : undefined;
  return (
    <div className={`flex items-center gap-3 rounded-lg border-2 p-4 ${p.refundable ? "border-amber bg-amber-soft" : "border-red bg-red-soft"}`} role="alert">
      <Banknote className={`size-8 shrink-0 ${p.refundable ? "text-amber" : "text-red"}`} />
      <div>
        <div className="text-lg font-bold">
          {p.refundable ? "Money committed" : "Money at risk"}: {formatMoney(p.amountPKR, "PKR")}{eur != null && ` / ${formatMoney(Math.round(eur), "EUR")}`} {p.refundable ? "(refundable)" : "NON-REFUNDABLE"}
        </div>
        <div className="text-xs">{formatMoney(p.amount, p.currency)} · {p.type.replace(/_/g, " ")} · {p.payee ?? ""}</div>
      </div>
    </div>
  );
}

export default async function GatesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const repo = await getRepo();
  const b = await loadCaseBundle(repo, actor.organizationId, id);
  const ctx = gateContext(b);
  const e = b.eligibility;
  const to = nextStage(b.kase.stage);
  const action = to ? IRREVERSIBLE_TRANSITIONS[to] : undefined;
  const clearance = riskClearance(ctx);
  const events = await repo.list<GateEvent>("gateEvents", [["organizationId", "==", actor.organizationId], ["caseId", "==", id]], { orderBy: "createdAt", desc: true });
  const pending = b.approvals.filter((a) => a.kind === "preflight" && a.status === "pending_manager");
  const override = b.approvals.find((a) => a.kind === "override" && a.status === "approved" && a.eligibilityFingerprint === e?.fingerprint);
  const ack = b.riskAcks.filter((r) => r.status !== "void").sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  const eurRate = new RuleContext(b.rules, { country: b.kase.country }).num("fx.EUR_PKR")?.value;
  const payLater = STAGES.indexOf(b.kase.stage) > STAGES.indexOf("Manager Approved") && STAGES.indexOf(b.kase.stage) < STAGES.indexOf("Decision");
  const laterBlockers = payLater ? preflightBlockers(ctx, "pay_fee") : [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Next step: {to ?? "— (final stage)"}</CardTitle>
          <CardDescription>Stages run in order. Every transition is re-checked on the server; irreversible ones only via pre-flight with Officer + Manager confirmation.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {to && !action && (() => {
            const blockers = transitionBlockers(ctx, to, { actorId: actor.id, actorRole: actor.role });
            return blockers.length ? (
              <Alert tone="red" title={<span className="inline-flex items-center gap-1.5"><Lock className="size-4" /> Gate closed</span>}>
                <ul className="list-disc space-y-0.5 pl-5 text-xs">{blockers.map((x) => <li key={x}>{x}</li>)}</ul>
              </Alert>
            ) : can(actor.role, "case.transition") ? (
              <>
                <Alert tone="green" title={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" /> Gate open</span>}>All conditions for “{to}” are met.</Alert>
                <TransitionForm caseId={id} to={to} />
              </>
            ) : null;
          })()}
          {action && (() => {
            const blockers = preflightBlockers(ctx, action);
            return (
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-base font-semibold"><ShieldAlert className="size-5 text-red" /> PRE-FLIGHT — {ACTION_LABELS[action]}</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Current assessment</div>
                    <div className="mt-1 flex items-center gap-2"><LightBadge light={e?.light} /> <span className="text-sm">{e?.score ?? "—"}/100</span></div>
                    <div className="mt-1 text-xs">{e?.lightReason}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Rule verification status</div>
                    {e?.ruleIssues.length ? <ul className="mt-1 text-xs text-red">{e.ruleIssues.map((i) => <li key={i.key}>{i.key}: {i.problem}</li>)}</ul> : <div className="mt-1 text-xs text-green">All rules used are verified and fresh.</div>}
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Open warnings</div>
                    <div className="mt-1 text-sm">{e?.reasons.filter((r) => r.severity !== "info").length ?? 0} ({e?.criticalFlags ?? 0} critical)</div>
                  </div>
                </div>
                {e && e.reasons.some((r) => r.severity !== "info") && (
                  <ul className="list-disc space-y-0.5 rounded-md border p-3 pl-7 text-xs">{e.reasons.filter((r) => r.severity !== "info").map((r) => <li key={r.id} className={r.hardFail ? "font-medium text-red" : ""}>{r.title}</li>)}</ul>
                )}
                {blockers.length ? (
                  <Alert tone="red" title="Pre-flight cannot start — nothing can be paid or submitted">
                    <ul className="list-disc space-y-0.5 pl-5 text-xs">{blockers.map((x) => <li key={x}>{x}</li>)}</ul>
                    <p className="mt-2 text-xs">Attempts are still recorded for the audit trail and the “money protected” metric.</p>
                  </Alert>
                ) : <Alert tone="green">All gates pass. Officer confirms first; a different Manager must confirm to execute.</Alert>}
                {can(actor.role, "preflight.request") && <PreflightForm caseId={id} action={action} label={ACTION_LABELS[action]} defaultType={DEFAULT_TYPE[action]} />}
              </div>
            );
          })()}
          {payLater && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Authorise another non-refundable payment (deposit, visa fee, IHS…)</summary>
              <div className="mt-3 flex flex-col gap-3">
                {laterBlockers.length > 0 && <Alert tone="red" title="Blocked"><ul className="list-disc pl-5 text-xs">{laterBlockers.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
                {can(actor.role, "preflight.request") && <PreflightForm caseId={id} action="pay_fee" label="Authorise payment" defaultType="tuition_deposit" />}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {pending.map((p) => (
        <Card key={p.id} className="border-red/50">
          <CardHeader>
            <CardTitle>Awaiting Manager confirmation — {ACTION_LABELS[p.action!]}</CardTitle>
            <CardDescription>Officer {p.requestedByName} confirmed {formatDateTime(p.officerConfirmedAt)}. Snapshot: {p.snapshot?.light}, {p.snapshot?.openWarnings.length} warnings, {p.snapshot?.ruleStatus.length} rule issues.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <MoneyAtRisk a={p} eurRate={eurRate} />
            {can(actor.role, "preflight.confirm_manager") ? (
              p.officerConfirmedBy === actor.id ? <Alert tone="amber">You started this pre-flight. A different Manager must confirm (two-person rule).</Alert> : <ConfirmPreflightForm caseId={id} approvalId={p.id} nonRefundable={!!p.payment && !p.payment.refundable} />
            ) : <p className="text-sm text-muted-foreground">Waiting for a Manager.</p>}
            <p className="text-[11px] text-muted-foreground">On confirmation the server re-runs the assessment and every gate. If anything changed, execution is refused.</p>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Manager override & student risk acknowledgment</CardTitle>
          <CardDescription>Required when the status is RED or AMBER with critical flags. Overrides cannot bypass unverified rules and are void as soon as the assessment changes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!needsOverride(e) ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-green" /> Not required for the current assessment.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone={override ? "green" : "red"}>Override: {override ? `granted by ${override.requestedByName}` : "not granted"}</Badge>
                <Badge tone={ack?.status === "signed" && ack.eligibilityFingerprint === e?.fingerprint ? "green" : "red"}>Student acknowledgment: {ack ? (ack.eligibilityFingerprint === e?.fingerprint ? ack.status : "outdated") : "none"}</Badge>
              </div>
              {override && <p className="rounded-md border p-2 text-sm">“{override.reason}”</p>}
              {ack?.status === "signed" && (
                <div className="rounded-md border p-2 text-xs">
                  Signed by <strong>{ack.signedName}</strong> on {formatDateTime(ack.signedAt)}.
                  {ack.signatureDataUrl && <img src={ack.signatureDataUrl} alt="Student signature" className="mt-1 h-16 rounded border bg-white" />}
                </div>
              )}
              {ack?.status === "pending" && <Alert tone="amber">Waiting for the student to sign in their portal. Risks shown to the student: <ul className="mt-1 list-disc pl-5 text-xs">{ack.risks.map((r) => <li key={r}>{r}</li>)}</ul></Alert>}
              {!override && can(actor.role, "override.grant") && (e?.ruleIssues.length ? <Alert tone="amber">Verify the flagged rules first — overrides cannot bypass rule verification.</Alert> : <OverrideForm caseId={id} />)}
              {!clearance.cleared && <ul className="list-disc pl-5 text-xs text-muted-foreground">{clearance.blockers.map((x) => <li key={x}>{x}</li>)}</ul>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Gate history</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? <p className="text-sm text-muted-foreground">No gate events.</p> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Event</Th><Th>By</Th><Th>Detail</Th></tr></thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(ev.createdAt)}</Td>
                    <Td><Badge tone={ev.type === "blocked" ? "red" : ev.type === "preflight_executed" || ev.type === "transition" ? "green" : "neutral"}>{ev.type.replace(/_/g, " ")}</Badge></Td>
                    <Td className="text-xs">{ev.byName}</Td>
                    <Td className="text-xs">
                      {ev.fromStage && `${ev.fromStage}${ev.toStage ? ` → ${ev.toStage}` : ""}`} {ev.action && `· ${ACTION_LABELS[ev.action]}`}
                      {ev.amountAtRisk && <span className="ml-1 font-medium">· {formatMoney(ev.amountAtRisk.amountPKR, "PKR")} at risk</span>}
                      {ev.blockers && <ul className="mt-1 list-disc pl-4 text-muted-foreground">{ev.blockers.slice(0, 4).map((x) => <li key={x}>{x}</li>)}</ul>}
                      {ev.note && <div className="text-muted-foreground">{ev.note}</div>}
                    </Td>
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
