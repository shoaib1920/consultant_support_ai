import { notFound } from "next/navigation";
import type { Programme, Student, User } from "@/domain/types";
import { PageHeader } from "@/components/ui/primitives";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { CaseForm } from "@/components/case-form";

export const metadata = { title: "New case" };

export default async function NewCase({ searchParams }: { searchParams: Promise<{ studentId?: string; programmeId?: string }> }) {
  const actor = await staffPage("case.write");
  const sp = await searchParams;
  const repo = await getRepo();
  const student = sp.studentId ? await repo.get<Student>("students", sp.studentId) : null;
  if (!student || student.organizationId !== actor.organizationId) notFound();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [programmes, users] = await Promise.all([repo.list<Programme>("programmes", [org]), repo.list<User>("users", [org])]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`New case for ${student.personal.fullName}`} description="Pick a programme from the database to pre-fill requirements, or enter them manually. Requirements are snapshotted on the case." />
      <CaseForm studentId={student.id} programmes={programmes.filter((p) => p.active)} officers={users.filter((u) => u.role === "officer" && u.active)} defaultLevel={student.intended.level ?? "master"} preselect={sp.programmeId} />
    </div>
  );
}
