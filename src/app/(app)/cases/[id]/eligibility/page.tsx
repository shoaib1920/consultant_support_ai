import Link from "next/link";
import { ACTION_LABELS, COUNTRIES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { formatRuleValue } from "@/domain/rules";
import type { Programme, ReasonCategory, User } from "@/domain/types";
import { LightBadge, RuleStatusBadge } from "@/components/badges";
import { CaseForm } from "@/components/case-form";
import { CasForm, CountryCheckForm } from "@/components/case-edit-forms";
import { ReasonItem } from "@/components/reason";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";

export const metadata = { title: "Eligibility" };

const CATS: ReasonCategory[] = ["Academic", "Language", "Financial", "Documents", "Timeline", "Credibility", "Country", "Rules"];

export default async function EligibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const repo = await getRepo();
  const b = await loadCaseBundle(repo, actor.organizationId, id);
  const e = b.eligibility;
  const write = can(actor.role, "case.write");
  const usedRules = b.rules.filter((r) => e?.ruleIdsUsed.includes(r.id));
  const [programmes, users] = await Promise.all([repo.list<Programme>("programmes", [["organizationId", "==", actor.organizationId]]), repo.list<User>("users", [["organizationId", "==", actor.organizationId]])]);

  return (
    <div className="flex flex-col gap-4">
      {!e ? <EmptyState title="Not assessed yet" /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {CATS.map((c) => {
              const s = e.categoryScores[c];
              return (
                <Card key={c}>
                  <CardContent className="p-3">
                    <div className="text-[11px] text-muted-foreground">{c}</div>
                    <div className="mt-1 flex items-center justify-between gap-1"><span className="text-lg font-semibold tabular-nums">{s?.score ?? "—"}</span>{s && <LightBadge light={s.light} />}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>All findings ({e.reasons.length})</CardTitle>
              <CardDescription>Deterministic rules first. Each finding cites the rule, document or missing item behind it. “Insufficient data” means the engine refused to guess.</CardDescription>
            </CardHeader>
            <CardContent>
              {CATS.map((c) => {
                const rs = e.reasons.filter((r) => r.category === c);
                if (!rs.length) return null;
                return (
                  <section key={c} className="mb-3">
                    <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c}</h3>
                    <ul className="divide-y">{rs.map((r) => <ReasonItem key={r.id} r={r} caseId={id} />)}</ul>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Country gates — {COUNTRIES[b.kase.country].name}</CardTitle>
          <CardDescription>Blocking gates turn the case RED once the related irreversible step is next.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {COUNTRIES[b.kase.country].checks.map((chk) => {
            const st = b.kase.countryChecks[chk.key];
            return (
              <div key={chk.key} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {chk.label}
                    {chk.blocking ? <Badge tone="red">Blocking</Badge> : <Badge>Advisory</Badge>}
                    <Badge tone={st?.status === "complete" ? "green" : st?.status === "in_progress" ? "amber" : "neutral"}>{(st?.status ?? "not_started").replace("_", " ")}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{chk.help} {chk.requiredBefore !== "none" && `Before: ${ACTION_LABELS[chk.requiredBefore].toLowerCase()}.`} {st?.date && `· ${formatDate(st.date)}`}</div>
                </div>
                {write && <div className="md:w-[34rem]"><CountryCheckForm caseId={id} checkKey={chk.key} state={st} /></div>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {b.kase.country === "UK" && write && (
        <Card>
          <CardHeader>
            <CardTitle>CAS details</CardTitle>
            <CardDescription>Must match the application exactly. Mismatches with the uploaded CAS document are flagged.</CardDescription>
          </CardHeader>
          <CardContent><CasForm kase={b.kase} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rules this assessment depends on ({usedRules.length})</CardTitle>
          <CardDescription>A case can never be GREEN if any of these is Unverified, Conflicting or older than 60 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Rule</Th><Th>Value</Th><Th>Status</Th><Th>Last verified</Th></tr></thead>
            <tbody>
              {usedRules.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/rules?focus=${r.id}`} className="hover:underline">{r.label}</Link><div className="text-[11px] text-muted-foreground">{r.country}:{r.key}</div></Td>
                  <Td className="max-w-xs text-xs">{formatRuleValue(r)}</Td>
                  <Td><RuleStatusBadge rule={r} /></Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(r.lastVerifiedAt)}{r.verifiedBy ? ` · ${r.verifiedBy}` : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      {write && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Edit case details (programme requirements, dates, tuition)</summary>
          <div className="mt-3">
            <CaseForm studentId={b.kase.studentId} programmes={programmes} officers={users.filter((u) => u.role === "officer")} defaultLevel={b.kase.level} existing={b.kase} />
          </div>
        </details>
      )}
    </div>
  );
}
