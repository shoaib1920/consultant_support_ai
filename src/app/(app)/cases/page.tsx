import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { COUNTRIES, COUNTRY_CODES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import type { Case, User } from "@/domain/types";
import { STAGES } from "@/domain/types";
import { LightBadge, StageBadge } from "@/components/badges";
import { Badge, Card, EmptyState, PageHeader, Select, Table, Td, Th, buttonVariants } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Cases" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ country?: string; light?: string; stage?: string; mine?: string }> }) {
  const actor = await staffPage("case.read");
  const sp = await searchParams;
  const repo = await getRepo();
  const [all, users] = await Promise.all([repo.list<Case>("cases", [["organizationId", "==", actor.organizationId]], { orderBy: "updatedAt", desc: true }), repo.list<User>("users", [["organizationId", "==", actor.organizationId]])]);
  const cases = all.filter((c) => (!sp.country || c.country === sp.country) && (!sp.light || c.light === sp.light) && (!sp.stage || c.stage === sp.stage) && (!sp.mine || c.assignedOfficerId === actor.id));
  const name = (id?: string) => users.find((u) => u.id === id)?.name ?? "—";
  return (
    <div>
      <PageHeader
        title="Cases"
        description="One case = one student × one programme. Status is recomputed whenever anything changes."
        actions={can(actor.role, "case.write") && <Link href="/students" className={buttonVariants()}><Plus /> New case (pick student)</Link>}
      />
      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <Select name="country" defaultValue={sp.country ?? ""} className="w-40" aria-label="Country">
          <option value="">All countries</option>
          {COUNTRY_CODES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name}</option>)}
        </Select>
        <Select name="light" defaultValue={sp.light ?? ""} className="w-36" aria-label="Status">
          <option value="">All statuses</option>
          <option>RED</option><option>AMBER</option><option>GREEN</option>
        </Select>
        <Select name="stage" defaultValue={sp.stage ?? ""} className="w-48" aria-label="Stage">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={!!sp.mine} /> Assigned to me</label>
        <button className={buttonVariants({ variant: "outline", size: "sm" })}>Filter</button>
      </form>
      {cases.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No cases match">Change the filters, or open a student and create a case.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr><Th>Status</Th><Th>Student</Th><Th>Destination</Th><Th>Stage</Th><Th>Intake</Th><Th>Officer</Th><Th>Flags</Th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-muted/40">
                  <Td><LightBadge light={c.light} /></Td>
                  <Td>
                    <Link href={`/cases/${c.id}`} className="font-medium hover:underline">{c.studentName}</Link>
                    {c.demoTag && <div className="text-[11px] text-muted-foreground">{c.demoTag}</div>}
                  </Td>
                  <Td><div>{c.universityName}</div><div className="text-xs text-muted-foreground">{c.programmeName} · {COUNTRIES[c.country].name}</div></Td>
                  <Td><StageBadge stage={c.stage} /></Td>
                  <Td className="whitespace-nowrap">{formatDate(c.intakeStartDate)}</Td>
                  <Td className="whitespace-nowrap">{name(c.assignedOfficerId)}</Td>
                  <Td className="whitespace-nowrap">
                    {(c.criticalFlags ?? 0) > 0 && <Badge tone="red">{c.criticalFlags} critical</Badge>} {(c.ruleIssues ?? 0) > 0 && <Badge tone="amber">{c.ruleIssues} rule</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
