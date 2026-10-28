import { COUNTRIES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { Programme } from "@/domain/types";
import { SampleBadge } from "@/components/badges";
import { ProgrammeForm } from "@/components/programme-form";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Universities & programmes" };

export default async function ProgrammesPage() {
  const actor = await staffPage("rules.read");
  const programmes = await (await getRepo()).list<Programme>("programmes", [["organizationId", "==", actor.organizationId]]);
  const edit = can(actor.role, "programmes.edit");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Universities & programmes" description="Admin-editable database used by eligibility and matching. Requirements are snapshotted onto each case when it is created." />
      {programmes.some((p) => p.sampleData) && <Alert tone="amber">Entries marked “Sample data” are fictional institutions with realistic shapes for demonstration. Replace them with verified programme data before use.</Alert>}
      {Object.values(COUNTRIES).map((c) => {
        const ps = programmes.filter((p) => p.country === c.code);
        return (
          <Card key={c.code}>
            <CardHeader><CardTitle>{c.name} ({ps.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>University · programme</Th><Th>Min grade</Th><Th>English</Th><Th className="text-right">Tuition / yr</Th><Th>Intakes (deadline)</Th><Th>Notes</Th><Th></Th></tr></thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                      <Td><div className="font-medium">{p.universityName}</div><div className="text-xs text-muted-foreground">{p.name} · {p.city}{p.inLondon ? " (London)" : ""} · {p.durationMonths}m</div>{p.sampleData && <SampleBadge />}</Td>
                      <Td className="text-xs">{p.minCGPA4 != null && `CGPA ${p.minCGPA4}`}{p.minGermanGrade != null && `DE grade ${p.minGermanGrade}`}</Td>
                      <Td className="text-xs">{p.english.ielts && `IELTS ${p.english.ielts}`}{p.english.pte && ` · PTE ${p.english.pte}`}{p.english.moiAccepted && <Badge className="ml-1">MOI ok</Badge>}{p.english.germanLevel && ` · German ${p.english.germanLevel}`}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.tuitionPerYear, p.currency)}</Td>
                      <Td className="text-xs">{p.intakes.map((i) => <div key={i.label}>{i.label} ({formatDate(i.applicationDeadline)})</div>)}</Td>
                      <Td className="max-w-[14rem] text-[11px] text-muted-foreground">{p.complianceNotes}</Td>
                      <Td>{edit && <ProgrammeForm programme={p} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      {edit && (
        <Card>
          <CardHeader><CardTitle>Add a programme</CardTitle></CardHeader>
          <CardContent><ProgrammeForm /></CardContent>
        </Card>
      )}
    </div>
  );
}
