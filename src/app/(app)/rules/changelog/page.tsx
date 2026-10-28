import Link from "next/link";
import { formatDateTime } from "@/domain/dates";
import type { RuleChange } from "@/domain/types";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Rule changelog" };

const j = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));

export default async function ChangelogPage() {
  const actor = await staffPage("rules.read");
  const changes = await (await getRepo()).list<RuleChange>("ruleChangelog", [["organizationId", "==", actor.organizationId]], { orderBy: "createdAt", desc: true });
  return (
    <div>
      <PageHeader title="Rule changelog" description="Every create, edit and verification of a rule, with who and why." actions={<Link href="/rules" className="text-sm text-primary underline">Back to rules</Link>} />
      {changes.length === 0 ? <EmptyState title="No rule changes yet">Seeded rules appear here once a manager edits or verifies them.</EmptyState> : (
        <Card>
          <Table>
            <thead><tr><Th>When</Th><Th>Rule</Th><Th>Action</Th><Th>By</Th><Th>Before → after</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</Td>
                  <Td className="text-xs"><Link href={`/rules?focus=${c.ruleId}`} className="hover:underline">{c.country}:{c.ruleKey}</Link></Td>
                  <Td><Badge tone={c.action === "verify" ? "green" : "neutral"}>{c.action}</Badge></Td>
                  <Td className="text-xs">{c.changedByName}</Td>
                  <Td className="max-w-md text-[11px] text-muted-foreground">{j(c.before)} → {j(c.after)}</Td>
                  <Td className="text-xs">{c.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
