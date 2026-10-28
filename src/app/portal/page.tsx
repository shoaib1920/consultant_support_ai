// Student portal: plain-language status only. Never shows internal risk scores, lights or staff notes.

import Link from "next/link";
import { CheckCircle2, CircleDashed, FileWarning, PenLine, XCircle } from "lucide-react";
import { COUNTRIES, DOC_LABELS, requiredDocsFor } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import type { Case, DocumentRecord, RiskAcknowledgment, Stage } from "@/domain/types";
import { UploadForm } from "@/components/doc-forms";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, buttonVariants } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { studentPage } from "@/server/page-guard";

export const metadata = { title: "My application" };

const PLAIN: Record<Stage, string> = {
  Lead: "We are collecting your details.",
  "Profile Complete": "Your profile is complete. Please upload your documents.",
  "Docs Verified": "Your documents have been checked. We are now assessing your eligibility.",
  "Eligibility Passed": "Your eligibility check is done. A manager is reviewing your file.",
  "Manager Approved": "Your file is approved internally. We will confirm any payment with you before making it.",
  "Payment Authorized": "Your application fee is authorised. We are preparing your application.",
  Submitted: "Your application has been submitted to the university.",
  "Offer/Admission": "You have an offer. We are preparing your visa file.",
  "Visa Filed": "Your visa application has been filed. Waiting for a decision.",
  Decision: "A visa decision has been received. Your consultant will contact you.",
  "Pre-departure": "Pre-departure: travel, accommodation and arrival preparation.",
};

export default async function PortalHome() {
  const actor = await studentPage();
  const repo = await getRepo();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [cases, docs, acks] = await Promise.all([
    repo.list<Case>("cases", [org, ["studentId", "==", actor.studentId!]]),
    repo.list<DocumentRecord>("documents", [org, ["studentId", "==", actor.studentId!]]),
    repo.list<RiskAcknowledgment>("riskAcknowledgments", [org, ["studentId", "==", actor.studentId!]]),
  ]);
  const pendingAcks = acks.filter((a) => a.status === "pending");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Assalam-o-Alaikum, {actor.name.split(" ")[0]}</h1>
      {pendingAcks.map((a) => (
        <Alert key={a.id} tone="amber" title={<span className="inline-flex items-center gap-1.5"><PenLine className="size-4" /> Your signature is needed</span>}>
          <p className="text-sm">Before we continue, please read the risks of proceeding and sign the acknowledgment.</p>
          <Link href={`/portal/sign/${a.id}`} className={buttonVariants({ size: "sm", className: "mt-2" })}>Read & sign</Link>
        </Alert>
      ))}
      {cases.length === 0 && <EmptyState title="No application yet">Your consultant will set up your application soon.</EmptyState>}
      {cases.map((c) => {
        const reqs = requiredDocsFor(c.country, c.level).filter((r) => !r.optional);
        const missing = reqs.filter((r) => !docs.some((d) => d.docType === r.docType && d.reviewStatus !== "rejected"));
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.universityName} — {c.programmeName}</CardTitle>
              <p className="text-xs text-muted-foreground">{COUNTRIES[c.country].name} · starts {formatDate(c.intakeStartDate)}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Alert tone="blue"><strong>Status:</strong> {PLAIN[c.stage]}</Alert>
              <div>
                <div className="mb-1 text-sm font-medium">Your checklist</div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {reqs.map((r) => {
                    const d = docs.filter((x) => x.docType === r.docType).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
                    const st = !d ? "missing" : d.reviewStatus === "verified" ? "checked" : d.reviewStatus === "rejected" ? "re-upload" : "received";
                    return (
                      <li key={r.docType} className="flex items-start gap-2 text-sm">
                        {st === "checked" ? <CheckCircle2 className="mt-0.5 size-4 text-green" /> : st === "received" ? <CircleDashed className="mt-0.5 size-4 text-amber" /> : st === "re-upload" ? <FileWarning className="mt-0.5 size-4 text-red" /> : <XCircle className="mt-0.5 size-4 text-muted-foreground" />}
                        <span>{r.label} <span className="text-xs text-muted-foreground">— {st === "checked" ? "checked by our team" : st === "received" ? "received, being checked" : st === "re-upload" ? `please upload again${d?.reviewNote ? `: ${d.reviewNote}` : ""}` : "please upload"}</span></span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {missing.length > 0 && <p className="text-sm"><Badge tone="amber">{missing.length} missing</Badge> Please upload clear copies of <strong>all pages</strong>.</p>}
              <UploadForm caseId={c.id} types={[...new Set([...missing.map((m) => m.docType), ...reqs.map((r) => r.docType)])]} defaultType={missing[0]?.docType} />
            </CardContent>
          </Card>
        );
      })}
      {docs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Files you have shared</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 py-1.5"><span>{DOC_LABELS[d.docType]} <span className="text-xs text-muted-foreground">{d.fileName}</span></span><span className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Your consultant will never ask you to change, borrow or create documents or bank balances. If anyone does, please contact the consultancy owner.</p>
    </div>
  );
}
