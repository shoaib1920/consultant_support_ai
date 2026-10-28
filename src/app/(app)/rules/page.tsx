import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { COUNTRIES } from "@/domain/countries";
import { daysBetween, formatDate, todayISO } from "@/domain/dates";
import { STALE_AFTER_DAYS, formatRuleValue, ruleProblem } from "@/domain/rules";
import type { Rule } from "@/domain/types";
import { RuleStatusBadge } from "@/components/badges";
import { ActionButton } from "@/components/client-bits";
import { RuleCreateForm, RuleEditForm } from "@/components/rule-forms";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader, Select, Table, Td, Th, buttonVariants } from "@/components/ui/primitives";
import { verifyRuleAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Rules engine" };

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ country?: string; status?: string; focus?: string }> }) {
  const actor = await staffPage("rules.read");
  const sp = await searchParams;
  const rules = await (await getRepo()).list<Rule>("rules", [["organizationId", "==", actor.organizationId]]);
  const today = todayISO();
  const shown = rules
    .filter((r) => (!sp.country || r.country === sp.country) && (!sp.status || (sp.status === "problem" ? !!ruleProblem(r) : r.status === sp.status)))
    .sort((a, b) => (a.id === sp.focus ? -1 : b.id === sp.focus ? 1 : 0) || a.country.localeCompare(b.country) || a.key.localeCompare(b.key));
  const problems = rules.filter((r) => ruleProblem(r));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rules engine"
        description={`Every number the engine uses lives here — nothing is hard-coded. Rules older than ${STALE_AFTER_DAYS} days are STALE. A case can never be GREEN while any rule it depends on is Unverified, Conflicting or Stale.`}
        actions={<Link href="/rules/changelog" className={buttonVariants({ variant: "outline" })}>Rule changelog</Link>}
      />
      {problems.length > 0 && <Alert tone="amber" title={`${problems.length} rule(s) need a manager's verification`}>Cases depending on them show AMBER “Rule needs verification”.</Alert>}
      <form method="get" className="flex flex-wrap gap-2">
        <Select name="country" defaultValue={sp.country ?? ""} className="w-44" aria-label="Country">
          <option value="">All scopes</option>
          {Object.values(COUNTRIES).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          <option value="*">Global (FX, policy)</option>
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-48" aria-label="Status">
          <option value="">All statuses</option>
          <option value="problem">Needs verification (any)</option>
          <option>Verified</option><option>Unverified</option><option>Conflicting</option>
        </Select>
        <button className={buttonVariants({ variant: "outline", size: "sm" })}>Filter</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>Scope</Th><Th>Rule</Th><Th>Value</Th><Th>Status</Th><Th>Last verified</Th><Th>Source</Th><Th></Th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} id={r.id} className={r.id === sp.focus ? "bg-accent" : ""}>
                <Td className="whitespace-nowrap text-xs">{r.country === "*" ? "Global" : r.country}{r.level !== "*" && ` · ${r.level}`}{r.intake !== "*" && ` · ${r.intake}`}</Td>
                <Td><div className="text-sm font-medium">{r.label}</div><code className="text-[11px] text-muted-foreground">{r.key}</code>{r.notes && <div className="mt-1 max-w-md text-[11px] text-amber">{r.notes}</div>}</Td>
                <Td className="max-w-xs text-xs">{formatRuleValue(r)}</Td>
                <Td><RuleStatusBadge rule={r} /></Td>
                <Td className="whitespace-nowrap text-xs">{r.lastVerifiedAt ? <>{formatDate(r.lastVerifiedAt)} <span className="text-muted-foreground">({daysBetween(r.lastVerifiedAt.slice(0, 10), today)}d)</span><div className="text-muted-foreground">{r.verifiedBy}</div></> : "never"}</Td>
                <Td className="text-xs"><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">source <ExternalLink className="size-3" /></a>{r.sourceNote && <div className="max-w-[12rem] text-[11px] text-muted-foreground">{r.sourceNote}</div>}</Td>
                <Td className="min-w-[9rem]">
                  <div className="flex flex-col items-start gap-1">
                    {can(actor.role, "rules.verify") && (ruleProblem(r) || r.seed) && <ActionButton size="sm" action={verifyRuleAction.bind(null, r.id)} confirm={`Confirm you checked "${r.label}" = ${formatRuleValue(r)} against the official source today.`}>Mark verified</ActionButton>}
                    {can(actor.role, "rules.edit") && <RuleEditForm rule={r} canVerify={can(actor.role, "rules.verify")} />}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {can(actor.role, "rules.edit") && (
        <Card>
          <CardHeader><CardTitle>Add a rule</CardTitle></CardHeader>
          <CardContent><RuleCreateForm /></CardContent>
        </Card>
      )}
    </div>
  );
}
