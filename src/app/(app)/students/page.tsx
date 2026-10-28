import Link from "next/link";
import { Users } from "lucide-react";
import { profileCompleteness } from "@/domain/completeness";
import type { Case, Student } from "@/domain/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LightBadge } from "@/components/badges";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Progress, Table, Td, Th } from "@/components/ui/primitives";
import { createStudentAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await staffPage("student.read");
  const { q } = await searchParams;
  const repo = await getRepo();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [students, cases] = await Promise.all([repo.list<Student>("students", [org], { orderBy: "updatedAt", desc: true }), repo.list<Case>("cases", [org])]);
  const list = students.filter((s) => !q || `${s.personal.fullName} ${s.personal.email ?? ""} ${s.personal.phone ?? ""} ${s.personal.cnic ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Students" description="Intake and profiles. Open a student to edit the profile, upload documents, run matching or create a case." />
      {can(actor.role, "student.write") && (
        <Card>
          <CardHeader><CardTitle>New student (intake)</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={createStudentAction}>
              <div className="grid gap-2 sm:grid-cols-[1fr_12rem_14rem_auto] sm:items-end">
                <Field label="Full name (as on passport)"><Input name="fullName" required minLength={2} /></Field>
                <Field label="Phone / WhatsApp"><Input name="phone" /></Field>
                <Field label="Email"><Input name="email" type="email" /></Field>
                <SubmitButton>Create & open profile</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <form method="get" className="flex gap-2"><Input name="q" defaultValue={q} placeholder="Search name, email, phone, CNIC" className="max-w-sm" /></form>
      {list.length === 0 ? <EmptyState icon={<Users />} title="No students found" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Student</Th><Th>Completeness</Th><Th>Cases</Th><Th>Consent</Th></tr></thead>
            <tbody>
              {list.map((s) => {
                const c = profileCompleteness(s);
                const sc = cases.filter((k) => k.studentId === s.id);
                return (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <Td><Link href={`/students/${s.id}`} className="font-medium hover:underline">{s.personal.fullName}</Link><div className="text-xs text-muted-foreground">{s.personal.city ?? ""} {s.personal.phone ?? ""}</div></Td>
                    <Td className="w-48"><div className="flex items-center gap-2"><Progress value={c.percent} className="w-28" /><span className="text-xs tabular-nums">{c.percent}%</span></div></Td>
                    <Td><div className="flex flex-wrap gap-1">{sc.length === 0 ? <span className="text-xs text-muted-foreground">none</span> : sc.map((k) => <Link key={k.id} href={`/cases/${k.id}`}><LightBadge light={k.light} /></Link>)}</div></Td>
                    <Td className="text-xs">{s.consent.given ? "Given" : <span className="text-amber">Missing</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
