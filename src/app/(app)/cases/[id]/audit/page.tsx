import type { AuditEntry } from "@/domain/types";
import { AuditTable } from "@/components/audit-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Case audit" };

export default async function CaseAudit({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("audit.read");
  const { id } = await params;
  const entries = await (await getRepo()).list<AuditEntry>("auditLog", [["organizationId", "==", actor.organizationId], ["caseId", "==", id]], { orderBy: "seq", desc: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail for this case</CardTitle>
        <CardDescription>Append-only and hash-chained. AI outputs record the model and prompt version.</CardDescription>
      </CardHeader>
      <CardContent><AuditTable entries={entries} /></CardContent>
    </Card>
  );
}
