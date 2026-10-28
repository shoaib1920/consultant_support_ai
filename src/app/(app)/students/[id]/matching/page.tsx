import Link from "next/link";
import { notFound } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { COUNTRIES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { MatchResult, Programme, Student } from "@/domain/types";
import { ActionButton } from "@/components/client-bits";
import { Alert, Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";
import { createCaseFromProgrammeAction, runMatchingAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { pkr } from "@/lib/utils";

export const metadata = { title: "Matching" };

const bandTone = (b: string) => (b === "Good" || b === "Low risk" ? "green" : b === "Moderate" || b === "Medium" ? "amber" : "red");

export default async function MatchingPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("student.read");
  const { id } = await params;
  const repo = await getRepo();
  const s = await repo.get<Student>("students", id);
  if (!s || s.organizationId !== actor.organizationId) notFound();
  const m = await repo.get<MatchResult>("matchResults", `mr_${id}`);
  const programmes = await repo.list<Programme>("programmes", [["organizationId", "==", actor.organizationId]]);
  const sample = new Set(programmes.filter((p) => p.sampleData).map((p) => p.id));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Matching — ${s.personal.fullName}`}
        description="Ranked options across the 4 countries. Bands are estimates from your programme database — never a promise of admission or visa."
        actions={<><Link href={`/students/${id}`} className="text-sm text-primary underline">Back to profile</Link>{can(actor.role, "analysis.run") && <ActionButton action={runMatchingAction.bind(null, id)}>{m ? "Re-run matching" : "Run matching"}</ActionButton>}</>}
      />
      {!m ? <EmptyState title="Matching has not been run">Run matching to rank programmes for this student.</EmptyState> : (
        <>
          <Alert tone={m.strongMatch ? "green" : "amber"} title={m.strongMatch ? "Reasonable matches found" : "No strong match"}>
            <p className="text-sm">{m.honestSummary}</p>
            {m.alternatives.length > 0 && <ul className="mt-2 flex flex-col gap-1 text-sm">{m.alternatives.map((a) => <li key={a} className="flex items-start gap-1.5"><Lightbulb className="mt-0.5 size-4 shrink-0" /> {a}</li>)}</ul>}
            <p className="mt-2 text-[11px] text-muted-foreground">Computed {formatDate(m.updatedAt)}. Re-run after profile changes.</p>
          </Alert>
          <div className="flex flex-col gap-3">
            {m.options.map((o, i) => (
              <Card key={o.programmeId}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
                  <div className="flex w-16 shrink-0 flex-col items-center">
                    <div className="text-2xl font-semibold tabular-nums">{o.fitScore}</div>
                    <div className="text-[10px] text-muted-foreground">fit #{i + 1}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.universityName}</span>
                      <span className="text-sm text-muted-foreground">{o.programmeName}</span>
                      <Badge>{COUNTRIES[o.country].name}</Badge>
                      {sample.has(o.programmeId) && <Badge tone="neutral">Sample data</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <Badge tone={bandTone(o.acceptanceBand)}>Acceptance chance band: {o.acceptanceBand}</Badge>
                      <Badge tone={o.visaRiskBand === "Low" ? "green" : o.visaRiskBand === "Medium" ? "amber" : "red"}>Visa risk: {o.visaRiskBand}</Badge>
                      <Badge tone={o.intakeStatus === "open" ? "green" : o.intakeStatus === "closing_soon" ? "amber" : "red"}>Intake: {o.intakeStatus.replace("_", " ")}{o.intake ? ` (${o.intake.label}, apply by ${formatDate(o.intake.applicationDeadline)})` : ""}</Badge>
                      <Badge>Est. first-year cost {formatMoney(o.estimatedTotalCost.amount, o.estimatedTotalCost.currency)} ≈ {pkr(o.estimatedTotalCost.amountPKR)}</Badge>
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{o.why.map((w) => <li key={w}>{w}</li>)}</ul>
                    {o.missing.length > 0 && <div className="mt-1 text-xs"><span className="font-medium">Missing: </span>{o.missing.join(", ")}</div>}
                  </div>
                  {can(actor.role, "case.write") && <ActionButton size="sm" variant="outline" action={createCaseFromProgrammeAction.bind(null, id, o.programmeId)}>Create case</ActionButton>}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
