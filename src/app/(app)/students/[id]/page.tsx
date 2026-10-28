import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { COUNTRIES, DOC_LABELS } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import type { Case, DocType, DocumentRecord, Student } from "@/domain/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LightBadge, StageBadge } from "@/components/badges";
import { ActionButton, CopyField } from "@/components/client-bits";
import { UploadForm } from "@/components/doc-forms";
import { ProfileEditor } from "@/components/profile-editor";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, PageHeader, buttonVariants } from "@/components/ui/primitives";
import { deleteStudentAction, intakeLinkAction, portalAccountAction, saveProfileAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { CONSENT_TEXT } from "@/server/services/students";

export const metadata = { title: "Student" };

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("student.read");
  const { id } = await params;
  const repo = await getRepo();
  const s = await repo.get<Student>("students", id);
  if (!s || s.organizationId !== actor.organizationId) notFound();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [cases, docs] = await Promise.all([repo.list<Case>("cases", [org, ["studentId", "==", id]]), repo.list<DocumentRecord>("documents", [org, ["studentId", "==", id]])]);
  const write = can(actor.role, "student.write");
  const save = saveProfileAction.bind(null, id);
  const intakeActive = s.intakeToken && s.intakeTokenExpiresAt && s.intakeTokenExpiresAt > new Date().toISOString();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={s.personal.fullName}
        description={`${s.personal.city ?? ""} · consent ${s.consent.given ? `given ${formatDate(s.consent.at)}` : "not recorded"}`}
        actions={
          <>
            <Link href={`/students/${id}/matching`} className={buttonVariants({ variant: "outline" })}><Search /> Country & university matching</Link>
            {can(actor.role, "case.write") && <Link href={`/cases/new?studentId=${id}`} className={buttonVariants()}><Plus /> New case</Link>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Cases</CardTitle></CardHeader>
          <CardContent>
            {cases.length === 0 ? <p className="text-sm text-muted-foreground">No cases yet. Run matching or create a case.</p> : (
              <ul className="divide-y">
                {cases.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/cases/${c.id}`} className="hover:underline"><span className="font-medium">{c.universityName}</span> <span className="text-xs text-muted-foreground">{c.programmeName} · {COUNTRIES[c.country].name}</span></Link>
                    <span className="flex gap-2"><StageBadge stage={c.stage} /><LightBadge light={c.light} /></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Student access</CardTitle><CardDescription>Secure link to self-fill the profile, or a portal account.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {intakeActive && <div className="text-xs">Active intake link (expires {formatDate(s.intakeTokenExpiresAt)}):<CopyField value={`/intake/${s.intakeToken}`} /></div>}
            {write && <ActionButton variant="outline" size="sm" action={intakeLinkAction.bind(null, id)}>{intakeActive ? "Regenerate secure intake link" : "Create secure intake link"}</ActionButton>}
            {s.portalUserId ? <Badge tone="green">Portal account active</Badge> : write && <ActionButton variant="outline" size="sm" action={portalAccountAction.bind(null, id)}>Create portal account</ActionButton>}
            <a href={`/api/students/${id}/export`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Download /> Export all data (JSON)</a>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Student documents ({docs.length})</CardTitle><CardDescription>Documents shared by all of this student's cases. Review them inside a case.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">{docs.map((d) => <Badge key={d.id} tone={d.reviewStatus === "verified" ? "green" : d.reviewStatus === "needs_manual_verification" ? "amber" : "neutral"}>{DOC_LABELS[d.docType]}</Badge>)}</div>
          {can(actor.role, "doc.upload") && <UploadForm studentId={id} types={Object.keys(DOC_LABELS) as DocType[]} compact />}
        </CardContent>
      </Card>

      {write ? <ProfileEditor student={s} save={save} mode="staff" consentText={CONSENT_TEXT} /> : <Alert>Read-only: your role cannot edit profiles.</Alert>}

      {can(actor.role, "student.delete") && (
        <Card className="border-red/40">
          <CardHeader><CardTitle className="text-red">Delete student data</CardTitle><CardDescription>Permanently deletes the profile, cases, documents (files), analyses and payments. The immutable audit log keeps a record that a deletion happened, without personal data.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={deleteStudentAction.bind(null, id)}>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={`Type "${s.personal.fullName}" to confirm`}><Input name="confirmName" required className="w-72" /></Field>
                <SubmitButton variant="destructive">Delete permanently</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
