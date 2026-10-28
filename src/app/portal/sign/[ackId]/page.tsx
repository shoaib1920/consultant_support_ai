import { notFound } from "next/navigation";
import { formatDateTime } from "@/domain/dates";
import type { Case, RiskAcknowledgment } from "@/domain/types";
import { SignaturePad } from "@/components/signature-pad";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { studentPage } from "@/server/page-guard";

export const metadata = { title: "Risk acknowledgment" };

export default async function SignPage({ params }: { params: Promise<{ ackId: string }> }) {
  const actor = await studentPage();
  const { ackId } = await params;
  const repo = await getRepo();
  const ack = await repo.get<RiskAcknowledgment>("riskAcknowledgments", ackId);
  if (!ack || ack.organizationId !== actor.organizationId || ack.studentId !== actor.studentId) notFound();
  const c = await repo.get<Case>("cases", ack.caseId);
  return (
    <Card>
      <CardHeader><CardTitle>Risk acknowledgment — {c?.universityName}, {c?.programmeName}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {ack.status === "signed" ? (
          <Alert tone="green">You signed this on {formatDateTime(ack.signedAt)} as “{ack.signedName}”.</Alert>
        ) : ack.status === "void" ? (
          <Alert>This acknowledgment is no longer needed.</Alert>
        ) : (
          <>
            <p>Our checks found the following risks with this application. Your consultant has decided it may still be reasonable to proceed, but <strong>you should understand that fees paid may be lost if the application or visa is refused.</strong></p>
            <ul className="list-disc space-y-1 rounded-md border p-3 pl-7">{ack.risks.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="text-xs text-muted-foreground">Nobody can guarantee admission or a visa. This is not legal or immigration advice.</p>
            <SignaturePad ackId={ack.id} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
