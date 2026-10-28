import { CheckCircle2, CircleDashed, FileText, XCircle } from "lucide-react";
import { AUTHORITY_LABELS, chainEta } from "@/domain/attestation";
import { ACTION_LABELS, COUNTRIES, DOC_LABELS, requiredDocsFor } from "@/domain/countries";
import { formatDate, formatDateTime } from "@/domain/dates";
import type { DocType } from "@/domain/types";
import { SeverityBadge } from "@/components/badges";
import { FieldsEditor, ResolveFlagForm, ReviewForm, UploadForm } from "@/components/doc-forms";
import { AttestationStepForm } from "@/components/case-edit-forms";
import { ActionButton } from "@/components/client-bits";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { reextractAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";
import { signedUrl } from "@/server/storage";

export const metadata = { title: "Documents" };

const ALL_TYPES = Object.keys(DOC_LABELS) as DocType[];

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const b = await loadCaseBundle(await getRepo(), actor.organizationId, id);
  const reqs = requiredDocsFor(b.kase.country, b.kase.level);
  const urls = Object.fromEntries(await Promise.all(b.documents.map(async (d) => [d.id, await signedUrl(d.storagePath, d.mimeType, d.fileName)] as const)));
  const review = can(actor.role, "doc.review");
  const docs = [...b.documents].sort((x, y) => x.docType.localeCompare(y.docType));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Checklist — {COUNTRIES[b.kase.country].name}</CardTitle>
            <CardDescription>Each item is needed before a specific irreversible step. Only staff can mark a document verified.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 sm:grid-cols-2">
            {reqs.map((r) => {
              const ds = b.documents.filter((d) => d.docType === r.docType && d.reviewStatus !== "rejected");
              const ok = ds.some((d) => d.reviewStatus === "verified");
              return (
                <div key={r.docType} className="flex items-start gap-2 text-sm">
                  {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" /> : ds.length ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span>
                    {r.label} {r.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
                    <span className="block text-[11px] text-muted-foreground">before: {ACTION_LABELS[r.neededBefore].toLowerCase()} · {ok ? "verified" : ds.length ? "awaiting review" : "missing"}</span>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        {can(actor.role, "doc.upload") && (
          <Card>
            <CardHeader>
              <CardTitle>Upload</CardTitle>
              <CardDescription>The AI reads the document into fields. Text inside documents is treated as data, never as instructions.</CardDescription>
            </CardHeader>
            <CardContent>
              <UploadForm studentId={b.kase.studentId} caseId={b.kase.id} types={[...new Set([...reqs.map((r) => r.docType), ...ALL_TYPES])]} />
            </CardContent>
          </Card>
        )}
      </div>

      {docs.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents yet">Upload documents or share the portal link with the student.</EmptyState>
      ) : (
        docs.map((d) => {
          const ef = b.extracted.find((e) => e.documentId === d.id);
          const open = d.flags.filter((f) => !f.resolved);
          return (
            <Card key={d.id} id={d.id}>
              <CardHeader className="flex-row flex-wrap items-center gap-2">
                <CardTitle className="mr-2">{DOC_LABELS[d.docType]}</CardTitle>
                <a href={urls[d.id]} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">{d.fileName}</a>
                <Badge tone={d.reviewStatus === "verified" ? "green" : d.reviewStatus === "rejected" ? "red" : d.reviewStatus === "needs_manual_verification" ? "amber" : "neutral"}>{d.reviewStatus === "needs_manual_verification" ? "NEEDS MANUAL VERIFICATION" : d.reviewStatus}</Badge>
                <Badge tone="neutral">extraction: {d.extractionStatus}{ef ? ` · ${ef.source}` : ""}</Badge>
                {d.uploadedVia === "portal" && <Badge tone="blue">from student portal</Badge>}
                <span className="ml-auto text-[11px] text-muted-foreground">uploaded {formatDateTime(d.createdAt)}{d.reviewedBy ? ` · reviewed by ${d.reviewedBy}` : ""}</span>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {d.completeness && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {(["allPages", "legible", "notExpired", "correctType"] as const).map((k) => (
                      <Badge key={k} tone={d.completeness![k] ? "green" : "red"}>{d.completeness![k] ? "✓" : "✗"} {k === "allPages" ? "All pages" : k === "legible" ? "Legible" : k === "notExpired" ? "Not expired" : "Correct type"}</Badge>
                    ))}
                  </div>
                )}
                {d.flags.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {d.flags.map((f) => (
                      <li key={f.id} className="rounded-md border p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="text-xs font-medium">{f.code.replace(/_/g, " ")}</span>
                          {f.resolved && <Badge tone="green">Resolved by {f.resolved.by}</Badge>}
                        </div>
                        <p className="mt-1 text-xs">{f.message}</p>
                        {f.resolved ? <p className="mt-1 text-[11px] text-muted-foreground">Note: “{f.resolved.note}” · {formatDateTime(f.resolved.at)}</p> : review && f.needsManualVerification && <ResolveFlagForm documentId={d.id} flag={f} />}
                      </li>
                    ))}
                  </ul>
                )}
                {ef?.injectionSuspected && <Alert tone="amber">This document contains instruction-like text. It was handled as data only and cannot affect any decision.</Alert>}
                {ef && (
                  <details className="rounded-md border p-2">
                    <summary className="cursor-pointer text-xs font-medium">Extracted fields ({Object.keys(ef.fields).length}) · {ef.model ?? ef.source} {ef.promptVersion && `· ${ef.promptVersion}`}</summary>
                    <div className="mt-2">
                      {review ? <FieldsEditor documentId={d.id} fields={ef.fields} /> : (
                        <Table><tbody>{Object.entries(ef.fields).map(([k, v]) => <tr key={k}><Td className="w-48 text-xs text-muted-foreground">{k}</Td><Td className="text-xs">{String(v ?? "—")}</Td></tr>)}</tbody></Table>
                      )}
                      {ef.transactions && <p className="mt-2 text-xs text-muted-foreground">{ef.transactions.length} transactions extracted — analyse on the Financial tab.</p>}
                    </div>
                  </details>
                )}
                {review && (
                  <div className="flex flex-wrap items-center gap-2">
                    {d.reviewStatus !== "verified" && <ReviewForm documentId={d.id} />}
                    <ActionButton size="sm" variant="ghost" action={reextractAction.bind(null, d.id)}>Re-run AI extraction</ActionButton>
                    {open.length > 0 && <span className="text-xs text-muted-foreground">Resolve open flags before verifying.</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Card>
        <CardHeader>
          <CardTitle>Attestation tracker</CardTitle>
          <CardDescription>Expected durations come from the rules table (attestation.days.*). Late chains turn the case RED.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {b.attestations.length === 0 ? <p className="text-sm text-muted-foreground">No attestation chain is required for {COUNTRIES[b.kase.country].name} in this configuration.</p> : b.attestations.map((a) => {
            const eta = chainEta(a.steps);
            return (
              <div key={a.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">{a.documentLabel} <Badge tone="neutral">ETA {formatDate(eta.eta)}</Badge></div>
                <Table>
                  <thead><tr><Th>Step</Th><Th>Status</Th><Th>Submitted</Th><Th>Completed</Th><Th>Expected end</Th><Th></Th></tr></thead>
                  <tbody>
                    {a.steps.map((s, i) => (
                      <tr key={s.authority}>
                        <Td>{AUTHORITY_LABELS[s.authority]} <span className="text-[11px] text-muted-foreground">({s.expectedDays}d)</span></Td>
                        <Td><Badge tone={s.status === "completed" ? "green" : s.status === "rejected" ? "red" : s.status === "not_started" ? "neutral" : "amber"}>{s.status.replace("_", " ")}</Badge>{eta.steps[i].overdue && <Badge tone="red" className="ml-1">overdue</Badge>}</Td>
                        <Td>{formatDate(s.submittedAt)}</Td>
                        <Td>{formatDate(s.completedAt)}</Td>
                        <Td>{formatDate(eta.steps[i].expectedEnd)}</Td>
                        <Td>{can(actor.role, "case.write") && <AttestationStepForm caseId={b.kase.id} attestationId={a.id} step={s} />}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
