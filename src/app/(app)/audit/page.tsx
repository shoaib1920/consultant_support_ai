import { ShieldCheck, ShieldX } from "lucide-react";
import type { AuditEntry } from "@/domain/types";
import { AuditTable } from "@/components/audit-table";
import { Alert, Card, CardContent, PageHeader, Input } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { verifyChain } from "@/server/services/audit";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await staffPage("audit.read");
  const { q } = await searchParams;
  const repo = await getRepo();
  const [entries, chain] = await Promise.all([repo.list<AuditEntry>("auditLog", [["organizationId", "==", actor.organizationId]], { orderBy: "seq", desc: true }), verifyChain(repo, actor.organizationId)]);
  const shown = entries.filter((e) => !q || `${e.action} ${e.userName} ${e.entity} ${e.entityId}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" description="Immutable: append-only, each entry hash-chained to the previous one. Firestore rules deny updates and deletes for every client." />
      {chain.ok ? (
        <Alert tone="green" title={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" /> Chain verified</span>}>{chain.count} entries; every hash matches its content and predecessor.</Alert>
      ) : (
        <Alert tone="red" title={<span className="inline-flex items-center gap-1.5"><ShieldX className="size-4" /> Chain broken at entry #{chain.brokenAt}</span>}>An entry was altered or removed outside the application. Investigate immediately.</Alert>
      )}
      <form method="get"><Input name="q" defaultValue={q} placeholder="Filter by action, user, entity" className="max-w-sm" /></form>
      <Card><CardContent className="p-0"><AuditTable entries={shown} showCase /></CardContent></Card>
    </div>
  );
}
