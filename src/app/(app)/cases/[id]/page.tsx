import Link from "next/link";
import { CheckCircle2, CircleDashed, Download, Flag, ShieldAlert, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { ACTION_LABELS, nextIrreversibleAction } from "@/domain/countries";
import { formatDate, formatDateTime } from "@/domain/dates";
import { ReasonItem } from "@/components/reason";
import { ActionButton } from "@/components/client-bits";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, buttonVariants } from "@/components/ui/primitives";
import { recomputeAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";
import { buildReport } from "@/server/services/report";

export const metadata = { title: "Refusal Risk Report" };

export default async function CaseReport({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const b = await loadCaseBundle(await getRepo(), actor.organizationId, id);
  const r = buildReport(b);
  const e = b.eligibility;
  const next = nextIrreversibleAction(b.kase.stage);
  const tone = r.light === "RED" ? "red" : r.light === "AMBER" ? "amber" : r.light === "GREEN" ? "green" : "neutral";

  return (
    <div className="flex flex-col gap-4">
      <Alert tone={tone} title={<span className="text-base">{r.light ? `${r.light} — ${r.lightReason}` : "Not assessed yet"}</span>}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {r.gate.cleared ? (
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-green" /> Gates clear for: <strong>{next ? ACTION_LABELS[next] : "—"}</strong> (still needs pre-flight double confirmation).</span>
            ) : (
              <span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4 text-red" /> <strong>Payment and submission are blocked.</strong> {r.gate.blockers.length} blocker(s).</span>
            )}
          </div>
          <div className="no-print flex flex-wrap gap-2">
            {can(actor.role, "analysis.run") && <ActionButton variant="outline" size="sm" action={recomputeAction.bind(null, id, false)}>Re-run assessment</ActionButton>}
            {can(actor.role, "analysis.run") && (
              <ActionButton variant="outline" size="sm" action={recomputeAction.bind(null, id, true)}>
                <Sparkles /> Explain with AI{aiConfigured() ? "" : " (mock)"}
              </ActionButton>
            )}
            <a href={`/api/cases/${id}/report`} className={buttonVariants({ size: "sm" })}><Download /> Export PDF</a>
          </div>
        </div>
        {!r.gate.cleared && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {r.gate.blockers.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
      </Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Top risks</CardTitle></CardHeader>
          <CardContent>
            {r.top.length === 0 ? <EmptyState title="No open risks" icon={<CheckCircle2 />}>All checks pass on verified rules. GREEN is not a guarantee — keep normal diligence.</EmptyState> : <ul className="divide-y">{r.top.map((x) => <ReasonItem key={x.id} r={x} caseId={id} />)}</ul>}
            {e && e.reasons.filter((x) => x.severity !== "info").length > 5 && <Link href={`/cases/${id}/eligibility`} className="mt-2 inline-block text-xs text-primary underline">See all {e.reasons.length} findings →</Link>}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>What to fix</CardTitle></CardHeader>
            <CardContent>{r.fixes.length ? <ol className="list-decimal space-y-1 pl-4 text-sm">{r.fixes.map((f) => <li key={f}>{f}</li>)}</ol> : <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>What to ask the student</CardTitle></CardHeader>
            <CardContent>{r.ask.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{r.ask.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="text-sm text-muted-foreground">No open questions.</p>}</CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Checklist</CardTitle></CardHeader>
          <CardContent className="grid gap-1 sm:grid-cols-2">
            {r.checklist.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-sm">
                {c.status === "done" ? <CheckCircle2 className="size-4 shrink-0 text-green" /> : c.status === "flagged" ? <Flag className="size-4 shrink-0 text-red" /> : c.status === "pending" ? <CircleDashed className="size-4 shrink-0 text-amber" /> : <XCircle className="size-4 shrink-0 text-muted-foreground" />}
                <span className={c.status === "missing" ? "text-muted-foreground" : ""}>{c.label}</span>
                <span className="sr-only">{c.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Countdowns</CardTitle></CardHeader>
          <CardContent>
            {r.deadlines.length === 0 ? <p className="text-sm text-muted-foreground">No dated deadlines.</p> : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {r.deadlines.map((d) => (
                  <li key={d.key} className="flex items-start justify-between gap-2">
                    <span className="text-xs">{d.label}<br /><span className="text-muted-foreground">{formatDate(d.date)}</span></span>
                    <Badge tone={d.daysLeft < 0 ? "solidRed" : d.severity === "critical" ? "red" : d.severity === "warning" ? "amber" : "neutral"}>{d.daysLeft < 0 ? `${-d.daysLeft}d ago` : `${d.daysLeft}d`}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {e?.ai && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4" /> AI explanation <Badge tone="neutral">{e.ai.source === "mock" ? "Mock AI" : "Claude"} · {e.ai.model} · {e.ai.promptVersion}</Badge></CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{e.ai.summary}</p>
            <ul className="list-disc space-y-1 pl-5">
              {e.ai.points.map((p, i) => (
                <li key={i}>{p.text} <span className="text-[11px] text-muted-foreground">(cites {p.cites.length} finding(s) · confidence {p.confidence})</span></li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Generated {formatDateTime(e.ai.generatedAt)}. The AI explains the deterministic result and cannot change it. Staff decide.</p>
          </CardContent>
        </Card>
      )}
      {e && <p className="text-[11px] text-muted-foreground">Assessment {e.id} · engine {e.engineVersion} · computed {formatDateTime(e.createdAt)} · fingerprint {e.fingerprint}</p>}
    </div>
  );
}
