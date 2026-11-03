import { Fragment } from "react";
import { COUNTRIES } from "@/domain/countries";
import { formatDate, formatDateTime } from "@/domain/dates";
import { formatMoney } from "@/domain/funds";
import type { Programme } from "@/domain/types";
import { SampleBadge } from "@/components/badges";
import { ActionButton } from "@/components/client-bits";
import { ProgrammeForm } from "@/components/programme-form";
import { ProgrammeImport } from "@/components/programme-import";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { recheckProgrammeAction, resolveProgrammeChangesAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Universities & programmes" };

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function SourceCell({ p, edit }: { p: Programme; edit: boolean }) {
  const s = p.source;
  if (!s) return <span className="text-[11px] text-muted-foreground">Entered manually</span>;
  return (
    <div className="flex flex-col items-start gap-1 text-[11px]">
      <Badge tone={s.status === "in_sync" ? "green" : s.status === "changed" ? "amber" : "red"}>
        {s.status === "in_sync" ? "Official page ✓" : s.status === "changed" ? "Page changed" : "Page unreachable"}
      </Badge>
      {s.urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="max-w-[12rem] truncate text-primary hover:underline">{new URL(u).hostname}</a>
      ))}
      <span className="text-muted-foreground">checked {formatDateTime(s.checkedAt)}</span>
      {edit && <ActionButton size="sm" variant="outline" className="h-6 px-2 text-[11px]" action={recheckProgrammeAction.bind(null, p.id)}>Re-check now</ActionButton>}
    </div>
  );
}

export default async function ProgrammesPage() {
  const actor = await staffPage("rules.read");
  const programmes = await (await getRepo()).list<Programme>("programmes", [["organizationId", "==", actor.organizationId]]);
  const edit = can(actor.role, "programmes.edit");
  const changed = programmes.filter((p) => p.source?.status === "changed");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Universities & programmes" description="Requirements used by eligibility and matching. Import them from the university's official page; VisaGuard re-reads each page nightly and flags any change. Requirements are snapshotted onto each case when it is created." />
      {changed.length > 0 && <Alert tone="amber" title={`${changed.length} programme(s) changed on the official website`}>Review the proposed changes below and apply them, or keep the current values.</Alert>}
      {programmes.some((p) => p.sampleData) && <Alert tone="amber">Entries marked “Sample data” are fictional institutions with realistic shapes for demonstration. Replace them with verified programme data before use.</Alert>}
      {edit && (
        <Card>
          <CardHeader>
            <CardTitle>Import from the official university website</CardTitle>
            <CardDescription>No typing: the page is read for you and every value shows the sentence it came from.</CardDescription>
          </CardHeader>
          <CardContent><ProgrammeImport /></CardContent>
        </Card>
      )}
      {Object.values(COUNTRIES).map((c) => {
        const ps = programmes.filter((p) => p.country === c.code);
        return (
          <Card key={c.code}>
            <CardHeader><CardTitle>{c.name} ({ps.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>University · programme</Th><Th>Min grade</Th><Th>English</Th><Th className="text-right">Tuition / yr</Th><Th>Intakes (deadline)</Th><Th>Source</Th><Th>Notes</Th><Th></Th></tr></thead>
                <tbody>
                  {ps.map((p) => (
                    <Fragment key={p.id}>
                      <tr className={p.active ? "" : "opacity-50"}>
                        <Td><div className="font-medium">{p.universityName}</div><div className="text-xs text-muted-foreground">{p.name} · {p.city}{p.inLondon ? " (London)" : ""} · {p.durationMonths}m</div>{p.sampleData && <SampleBadge />}</Td>
                        <Td className="text-xs">{p.minCGPA4 != null && `CGPA ${p.minCGPA4}`}{p.minGermanGrade != null && `DE grade ${p.minGermanGrade}`}</Td>
                        <Td className="text-xs">{p.english.ielts && `IELTS ${p.english.ielts}`}{p.english.pte && ` · PTE ${p.english.pte}`}{p.english.moiAccepted && <Badge className="ml-1">MOI ok</Badge>}{p.english.germanLevel && ` · German ${p.english.germanLevel}`}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(p.tuitionPerYear, p.currency)}</Td>
                        <Td className="text-xs">{p.intakes.map((i) => <div key={i.label}>{i.label} ({formatDate(i.applicationDeadline)})</div>)}</Td>
                        <Td><SourceCell p={p} edit={edit} /></Td>
                        <Td className="max-w-[14rem] text-[11px] text-muted-foreground">{p.complianceNotes}{p.source?.status === "unreachable" && <div className="mt-1 text-red">{p.source.lastError}</div>}</Td>
                        <Td>{edit && <ProgrammeForm programme={p} />}</Td>
                      </tr>
                      {p.source?.status === "changed" && p.source.changes && (
                        <tr>
                          <Td colSpan={8} className="bg-amber-soft/60">
                            <div className="flex flex-col gap-2">
                              <div className="text-xs font-medium">The official page now says something different:</div>
                              <ul className="space-y-1 text-xs">
                                {p.source.changes.map((ch) => (
                                  <li key={ch.field}>
                                    <span className="font-medium">{ch.field}</span>: <span className="line-through opacity-70">{show(ch.before)}</span> → <strong>{show(ch.after)}</strong>
                                    {ch.evidence && <span className="ml-2 text-[11px] text-muted-foreground">“{ch.evidence}”</span>}
                                  </li>
                                ))}
                              </ul>
                              {edit && (
                                <div className="flex flex-wrap gap-2">
                                  <ActionButton size="sm" action={resolveProgrammeChangesAction.bind(null, p.id, true)}>Apply changes</ActionButton>
                                  <ActionButton size="sm" variant="outline" action={resolveProgrammeChangesAction.bind(null, p.id, false)}>Keep current values</ActionButton>
                                </div>
                              )}
                              <div className="text-[11px] text-muted-foreground">Cases already created keep the requirements they were assessed against; new cases use the updated values.</div>
                            </div>
                          </Td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      {edit && (
        <Card>
          <CardHeader><CardTitle>Add a programme by hand</CardTitle></CardHeader>
          <CardContent><ProgrammeForm /></CardContent>
        </Card>
      )}
    </div>
  );
}
