import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldX, XOctagon } from "lucide-react";
import { COUNTRIES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import type { Case } from "@/domain/types";
import { Bars } from "@/components/bars";
import { LightBadge, StageBadge } from "@/components/badges";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { ownerDashboard } from "@/server/services/dashboard";
import { pkr } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const actor = await staffPage("case.read");
  const repo = await getRepo();
  const d = await ownerDashboard(repo, actor.organizationId);
  const owner = can(actor.role, "dashboard.owner");
  const cases = await repo.list<Case>("cases", [["organizationId", "==", actor.organizationId]], { orderBy: "updatedAt", desc: true });
  const mine = cases.filter((c) => c.assignedOfficerId === actor.id || c.counsellorId === actor.id);
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={owner ? "Owner dashboard" : "My dashboard"} description="Pipeline, gate blocks and deadlines across the consultancy." />
      {sp.reset && <Alert tone="green">Demo data was reset.</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open cases" value={d.totals.cases} sub={`${d.totals.students} students`} />
        <Stat label="Blocked by gates" value={d.blockedCases.length} sub={`${d.blockedAttempts} blocked attempts recorded`} tone={d.blockedCases.length ? "red" : undefined} />
        {owner && <Stat label="Estimated money protected" value={pkr(d.moneySavedPKR)} sub="Non-refundable amounts stopped at the gate" tone="green" />}
        {owner && <Stat label="Money exposed in unresolved-risk cases" value={pkr(d.moneyExposedPKR)} sub="Non-refundable payments already made on RED/critical cases" tone={d.moneyExposedPKR ? "amber" : undefined} />}
        {!owner && <Stat label="Assigned to me" value={mine.length} />}
        {!owner && <Stat label="Deadlines ≤ 30 days" value={d.deadlines.length} tone={d.deadlines.some((x) => x.daysLeft <= 7) ? "red" : undefined} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
            <CardDescription>Number of cases at each gate-controlled stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <Bars rows={d.pipeline.map((p) => ({ label: p.stage, value: p.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Risk status</CardTitle>
            <CardDescription>Latest assessment per case.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-green" /> GREEN</span><span className="font-semibold tabular-nums">{d.lights.GREEN}</span></div>
            <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><AlertTriangle className="size-4 text-amber" /> AMBER</span><span className="font-semibold tabular-nums">{d.lights.AMBER}</span></div>
            <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><XOctagon className="size-4 text-red" /> RED</span><span className="font-semibold tabular-nums">{d.lights.RED}</span></div>
            {d.staleRules.length > 0 && (
              <Alert tone="amber" className="mt-2" title={`${d.staleRules.length} rule(s) need verification`}>
                <ul className="text-xs">
                  {d.staleRules.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <Link href={`/rules?focus=${r.id}`} className="underline">{r.country}:{r.key}</Link> — {r.problem}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldX className="size-4 text-red" /> Cases blocked by gates</CardTitle>
            <CardDescription>RED cases and cases with a blocked attempt in the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.blockedCases.length === 0 ? (
              <EmptyState title="Nothing blocked">No case is currently stopped at a gate.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y">
                {d.blockedCases.map((b) => (
                  <li key={b.caseId} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/cases/${b.caseId}`} className="font-medium hover:underline">{b.studentName}</Link>
                      <div className="truncate text-xs text-muted-foreground">{COUNTRIES[b.country].name} · {b.reason}</div>
                    </div>
                    <LightBadge light={b.light as Case["light"]} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Deadlines due (next 30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {d.deadlines.length === 0 ? (
              <EmptyState title="No deadlines in the next 30 days" />
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {d.deadlines.map((x) => (
                  <li key={`${x.caseId}-${x.key}`} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <Link href={`/cases/${x.caseId}/tasks`} className="font-medium hover:underline">{x.studentName}</Link>
                      <div className="truncate text-xs text-muted-foreground">{x.label} · {formatDate(x.date)}</div>
                    </div>
                    <Badge tone={x.daysLeft < 0 ? "solidRed" : x.daysLeft <= 7 ? "red" : x.daysLeft <= 14 ? "amber" : "neutral"}>{x.daysLeft < 0 ? `${-x.daysLeft}d overdue` : `${x.daysLeft}d`}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {owner && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>What the gates caught</CardTitle>
              <CardDescription>Blocker categories across all blocked attempts.</CardDescription>
            </CardHeader>
            <CardContent>{d.riskCategories.length ? <Bars rows={d.riskCategories.map((r) => ({ label: r.category, value: r.count }))} /> : <EmptyState title="No blocks yet" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Officer gate-block rate</CardTitle>
              <CardDescription>Blocked attempts ÷ all gate attempts. A high rate means training is needed, not blame.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.officerStats.length ? (
                <Table>
                  <thead><tr><Th>Officer</Th><Th className="text-right">Attempts</Th><Th className="text-right">Blocked</Th><Th className="text-right">Rate</Th></tr></thead>
                  <tbody>{d.officerStats.map((o) => <tr key={o.userId}><Td>{o.name}</Td><Td className="text-right tabular-nums">{o.attempts}</Td><Td className="text-right tabular-nums">{o.blocked}</Td><Td className="text-right tabular-nums">{o.errorRate}%</Td></tr>)}</tbody>
                </Table>
              ) : <EmptyState title="No activity yet" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Refusal reasons</CardTitle>
              <CardDescription>From recorded visa decisions.</CardDescription>
            </CardHeader>
            <CardContent>{d.refusalReasons.length ? <Bars rows={d.refusalReasons.map((r) => ({ label: r.reason, value: r.count }))} /> : <EmptyState title="No refusals recorded">Record decisions on cases to build this view.</EmptyState>}</CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Conversion by country</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Country</Th><Th className="text-right">Cases</Th><Th className="text-right">Submitted+</Th><Th className="text-right">Visa filed+</Th><Th className="text-right">Approved</Th><Th className="text-right">Refused</Th></tr></thead>
            <tbody>
              {d.conversion.map((c) => (
                <tr key={c.country}><Td>{c.name}</Td><Td className="text-right tabular-nums">{c.cases}</Td><Td className="text-right tabular-nums">{c.submitted}</Td><Td className="text-right tabular-nums">{c.visaFiled}</Td><Td className="text-right tabular-nums">{c.approved}</Td><Td className="text-right tabular-nums">{c.refused}</Td></tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      {mine.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Assigned to me</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y">
            {mine.map((c) => (
              <Link key={c.id} href={`/cases/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-muted/40">
                <span className="font-medium">{c.studentName} <span className="text-xs font-normal text-muted-foreground">· {c.universityName}</span></span>
                <span className="flex gap-2"><StageBadge stage={c.stage} /><LightBadge light={c.light} /></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
