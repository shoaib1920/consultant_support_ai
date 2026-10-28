"use client";

// Full student profile editor. Used by staff (/students/[id]) and by students via the secure intake link.

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { profileCompleteness } from "@/domain/completeness";
import type { CountryCode, EducationRecord, EnglishTest, Sponsor, Student, StudyGap, TravelRecord, VisaRefusal, WorkExperience } from "@/domain/types";
import type { ActionResult } from "@/server/actions/result";
import { ResultMessage } from "./action-form";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Progress, Select, Textarea } from "./ui/primitives";

type Draft = Omit<Student, "id" | "organizationId" | "createdAt" | "updatedAt" | "consent" | "intakeToken" | "intakeTokenExpiresAt" | "portalUserId" | "counsellorId"> & { consentGiven: boolean };

const rid = () => Math.random().toString(36).slice(2, 10);

function toDraft(s: Student): Draft {
  return {
    personal: { ...s.personal },
    education: s.education,
    gaps: s.gaps,
    englishTests: s.englishTests,
    work: s.work,
    sponsors: s.sponsors,
    budget: s.budget,
    intended: s.intended,
    refusals: s.refusals,
    travel: s.travel,
    tiesToPakistan: s.tiesToPakistan ?? "",
    internalNotes: s.internalNotes ?? "",
    consentGiven: s.consent.given,
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function Rows<T extends { id: string }>({ items, onChange, empty, render, add, addLabel }: { items: T[]; onChange: (v: T[]) => void; empty: string; render: (item: T, set: (patch: Partial<T>) => void) => React.ReactNode; add: () => T; addLabel: string }) {
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
      {items.map((it) => (
        <div key={it.id} className="relative rounded-md border p-3 pr-10">
          {render(it, (patch) => onChange(items.map((x) => (x.id === it.id ? { ...x, ...patch } : x))))}
          <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" aria-label="Remove" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, add()])}><Plus /> {addLabel}</Button>
      </div>
    </div>
  );
}

const num = (v: string) => (v === "" ? undefined : Number(v));

export function ProfileEditor({ student, save, mode, consentText }: { student: Student; save: (json: string) => Promise<ActionResult>; mode: "staff" | "intake"; consentText: string }) {
  const [d, setD] = React.useState<Draft>(() => toDraft(student));
  const [res, setRes] = React.useState<ActionResult | null>(null);
  const [pending, start] = React.useTransition();
  const router = useRouter();
  const p = d.personal;
  const setP = (patch: Partial<Draft["personal"]>) => setD({ ...d, personal: { ...p, ...patch } });
  const meter = profileCompleteness({ ...student, ...d, consent: { given: d.consentGiven } } as Student);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await save(JSON.stringify(d));
          setRes(r);
          if (r.ok && mode === "staff") router.refresh();
        });
      }}
    >
      <Card className="sticky top-14 z-20">
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="mb-1 flex justify-between text-xs"><span className="font-medium">Profile completeness</span><span className="tabular-nums">{meter.percent}%</span></div>
            <Progress value={meter.percent} />
            {meter.missing.length > 0 && <div className="mt-1 truncate text-[11px] text-muted-foreground" title={meter.missing.join(", ")}>Missing: {meter.missing.join(", ")}</div>}
          </div>
          <Button disabled={pending}>{pending ? "Saving…" : mode === "intake" ? "Submit my details" : "Save profile"}</Button>
        </CardContent>
      </Card>
      <ResultMessage state={res} />

      <Section title="Personal details" description="Exactly as on the passport.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Full name (as on passport)"><Input required value={p.fullName} onChange={(e) => setP({ fullName: e.target.value })} /></Field>
          <Field label="Given names"><Input value={p.givenNames ?? ""} onChange={(e) => setP({ givenNames: e.target.value })} /></Field>
          <Field label="Surname"><Input value={p.surname ?? ""} onChange={(e) => setP({ surname: e.target.value })} /></Field>
          <Field label="Father's name"><Input value={p.fatherName ?? ""} onChange={(e) => setP({ fatherName: e.target.value })} /></Field>
          <Field label="Date of birth"><Input type="date" value={p.dob ?? ""} onChange={(e) => setP({ dob: e.target.value })} /></Field>
          <Field label="Gender"><Select value={p.gender ?? ""} onChange={(e) => setP({ gender: (e.target.value || undefined) as never })}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></Field>
          <Field label="CNIC" hint="12345-1234567-1"><Input value={p.cnic ?? ""} onChange={(e) => setP({ cnic: e.target.value })} /></Field>
          <Field label="Passport number"><Input value={p.passportNumber ?? ""} onChange={(e) => setP({ passportNumber: e.target.value.toUpperCase() })} /></Field>
          <Field label="Passport expiry"><Input type="date" value={p.passportExpiry ?? ""} onChange={(e) => setP({ passportExpiry: e.target.value })} /></Field>
          <Field label="City"><Input value={p.city ?? ""} onChange={(e) => setP({ city: e.target.value })} /></Field>
          <Field label="Phone / WhatsApp"><Input value={p.phone ?? ""} onChange={(e) => setP({ phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={p.email ?? ""} onChange={(e) => setP({ email: e.target.value })} /></Field>
          <Field label="Marital status"><Select value={p.maritalStatus ?? ""} onChange={(e) => setP({ maritalStatus: (e.target.value || undefined) as never })}><option value="">—</option><option value="single">Single</option><option value="married">Married</option><option value="other">Other</option></Select></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={p.address ?? ""} onChange={(e) => setP({ address: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Education history" description="Include the grading scale — eligibility converts it. CGPA 2.45 on 4.0 is very different from 2.45 on 5.0.">
        <Rows<EducationRecord>
          items={d.education}
          onChange={(education) => setD({ ...d, education })}
          empty="No education recorded."
          addLabel="Add qualification"
          add={() => ({ id: rid(), level: "bachelor", institution: "", gradeType: "cgpa", total: 4, completed: true })}
          render={(e, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Level"><Select value={e.level} onChange={(x) => set({ level: x.target.value as EducationRecord["level"] })}><option value="matric">Matric</option><option value="o_level">O-Level</option><option value="intermediate">Intermediate</option><option value="a_level">A-Level</option><option value="bachelor">Bachelor</option><option value="master">Master</option></Select></Field>
              <Field label="Institution" className="sm:col-span-2"><Input required value={e.institution} onChange={(x) => set({ institution: x.target.value })} /></Field>
              <Field label="Board (BISE/FBISE…)"><Input value={e.board ?? ""} onChange={(x) => set({ board: x.target.value })} /></Field>
              <Field label="Programme"><Input value={e.program ?? ""} onChange={(x) => set({ program: x.target.value })} /></Field>
              <Field label="Field"><Input value={e.field ?? ""} onChange={(x) => set({ field: x.target.value })} /></Field>
              <Field label="Start"><Input type="date" value={e.startDate ?? ""} onChange={(x) => set({ startDate: x.target.value })} /></Field>
              <Field label="End"><Input type="date" value={e.endDate ?? ""} onChange={(x) => set({ endDate: x.target.value })} /></Field>
              <Field label="Grade type"><Select value={e.gradeType} onChange={(x) => set({ gradeType: x.target.value as EducationRecord["gradeType"] })}><option value="percentage">Marks / percentage</option><option value="cgpa">CGPA</option><option value="grade">Letter / division</option></Select></Field>
              <Field label={e.gradeType === "cgpa" ? "CGPA obtained" : "Marks obtained"}><Input type="number" step="0.01" value={e.obtained ?? ""} onChange={(x) => set({ obtained: num(x.target.value) })} /></Field>
              <Field label={e.gradeType === "cgpa" ? "Scale (e.g. 4)" : "Total marks"}><Input type="number" step="0.01" value={e.total ?? ""} onChange={(x) => set({ total: num(x.target.value) })} /></Field>
              <Field label="Backlogs / repeats"><Input type="number" min={0} value={e.backlogs ?? ""} onChange={(x) => set({ backlogs: num(x.target.value) })} /></Field>
            </div>
          )}
        />
      </Section>

      <Section title="Study gaps" description="Any period with no study — explain with evidence.">
        <Rows<StudyGap>
          items={d.gaps}
          onChange={(gaps) => setD({ ...d, gaps })}
          empty="No gaps recorded."
          addLabel="Add gap"
          add={() => ({ id: rid(), from: "", to: "", reason: "" })}
          render={(g, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="From"><Input type="date" required value={g.from} onChange={(x) => set({ from: x.target.value })} /></Field>
              <Field label="To"><Input type="date" required value={g.to} onChange={(x) => set({ to: x.target.value })} /></Field>
              <Field label="Reason" className="sm:col-span-2"><Input value={g.reason} onChange={(x) => set({ reason: x.target.value })} /></Field>
              <Field label="Evidence" className="sm:col-span-4"><Input value={g.evidence ?? ""} onChange={(x) => set({ evidence: x.target.value })} /></Field>
            </div>
          )}
        />
      </Section>

      <Section title="English tests">
        <Rows<EnglishTest>
          items={d.englishTests}
          onChange={(englishTests) => setD({ ...d, englishTests })}
          empty="No English test recorded."
          addLabel="Add test / MOI"
          add={() => ({ id: rid(), type: "IELTS" })}
          render={(t, set) => (
            <div className="grid gap-2 sm:grid-cols-7">
              <Field label="Type"><Select value={t.type} onChange={(x) => set({ type: x.target.value as never })}><option>IELTS</option><option>PTE</option><option>Duolingo</option><option>TOEFL</option><option>MOI</option></Select></Field>
              {t.type !== "MOI" && (
                <>
                  <Field label="Overall"><Input type="number" step="0.5" value={t.overall ?? ""} onChange={(x) => set({ overall: num(x.target.value) })} /></Field>
                  <Field label="L"><Input type="number" step="0.5" value={t.listening ?? ""} onChange={(x) => set({ listening: num(x.target.value) })} /></Field>
                  <Field label="R"><Input type="number" step="0.5" value={t.reading ?? ""} onChange={(x) => set({ reading: num(x.target.value) })} /></Field>
                  <Field label="W"><Input type="number" step="0.5" value={t.writing ?? ""} onChange={(x) => set({ writing: num(x.target.value) })} /></Field>
                  <Field label="S"><Input type="number" step="0.5" value={t.speaking ?? ""} onChange={(x) => set({ speaking: num(x.target.value) })} /></Field>
                </>
              )}
              <Field label="Test date"><Input type="date" value={t.testDate ?? ""} onChange={(x) => set({ testDate: x.target.value })} /></Field>
            </div>
          )}
        />
      </Section>

      <Section title="Work experience">
        <Rows<WorkExperience>
          items={d.work}
          onChange={(work) => setD({ ...d, work })}
          empty="No work experience."
          addLabel="Add job"
          add={() => ({ id: rid(), employer: "", title: "", from: "" })}
          render={(w, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Employer"><Input required value={w.employer} onChange={(x) => set({ employer: x.target.value })} /></Field>
              <Field label="Title"><Input required value={w.title} onChange={(x) => set({ title: x.target.value })} /></Field>
              <Field label="From"><Input type="date" required value={w.from} onChange={(x) => set({ from: x.target.value })} /></Field>
              <Field label="To (blank = current)"><Input type="date" value={w.to ?? ""} onChange={(x) => set({ to: x.target.value || undefined })} /></Field>
            </div>
          )}
        />
      </Section>

      <Section title="Sponsors & budget">
        <Rows<Sponsor>
          items={d.sponsors}
          onChange={(sponsors) => setD({ ...d, sponsors })}
          empty="No sponsor recorded."
          addLabel="Add sponsor"
          add={() => ({ id: rid(), name: "", relation: "" })}
          render={(s, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Name"><Input required value={s.name} onChange={(x) => set({ name: x.target.value })} /></Field>
              <Field label="Relation"><Input required value={s.relation} onChange={(x) => set({ relation: x.target.value })} /></Field>
              <Field label="Occupation"><Input value={s.occupation ?? ""} onChange={(x) => set({ occupation: x.target.value })} /></Field>
              <Field label="Annual income (PKR)"><Input type="number" value={s.annualIncomePKR ?? ""} onChange={(x) => set({ annualIncomePKR: num(x.target.value) })} /></Field>
            </div>
          )}
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Total budget for first year (PKR)"><Input type="number" value={d.budget.totalPKR ?? ""} onChange={(x) => setD({ ...d, budget: { ...d.budget, totalPKR: num(x.target.value) } })} /></Field>
          <Field label="Budget notes" className="sm:col-span-2"><Input value={d.budget.notes ?? ""} onChange={(x) => setD({ ...d, budget: { ...d.budget, notes: x.target.value } })} /></Field>
        </div>
      </Section>

      <Section title="Study plans">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Intended level"><Select value={d.intended.level ?? ""} onChange={(x) => setD({ ...d, intended: { ...d.intended, level: (x.target.value || undefined) as never } })}><option value="">—</option><option value="foundation">Foundation</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="phd">PhD</option></Select></Field>
          <Field label="Field"><Input value={d.intended.field ?? ""} onChange={(x) => setD({ ...d, intended: { ...d.intended, field: x.target.value } })} /></Field>
          <Field label="Intake (YYYY-MM)"><Input pattern="\d{4}-\d{2}" placeholder="2027-09" value={d.intended.intake ?? ""} onChange={(x) => setD({ ...d, intended: { ...d.intended, intake: x.target.value } })} /></Field>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["UK", "DE", "IT", "FR"] as CountryCode[]).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" checked={d.intended.countries.includes(c)} onChange={(x) => setD({ ...d, intended: { ...d.intended, countries: x.target.checked ? [...d.intended.countries, c] : d.intended.countries.filter((y) => y !== c) } })} />
              {{ UK: "United Kingdom", DE: "Germany", IT: "Italy", FR: "France" }[c]}
            </label>
          ))}
        </div>
        <Field label="Ties to Pakistan (family, job offer, property, business plans)"><Textarea value={d.tiesToPakistan ?? ""} onChange={(x) => setD({ ...d, tiesToPakistan: x.target.value })} /></Field>
      </Section>

      <Section title="Visa refusals & travel history" description="Declare every refusal — undeclared refusals are a common reason for refusal.">
        <Rows<VisaRefusal>
          items={d.refusals}
          onChange={(refusals) => setD({ ...d, refusals })}
          empty="No previous refusals."
          addLabel="Add refusal"
          add={() => ({ id: rid(), country: "", year: new Date().getFullYear() })}
          render={(r, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Country"><Input required value={r.country} onChange={(x) => set({ country: x.target.value })} /></Field>
              <Field label="Year"><Input type="number" required value={r.year} onChange={(x) => set({ year: Number(x.target.value) })} /></Field>
              <Field label="Reason" className="sm:col-span-2"><Input value={r.reason ?? ""} onChange={(x) => set({ reason: x.target.value })} /></Field>
            </div>
          )}
        />
        <Rows<TravelRecord>
          items={d.travel}
          onChange={(travel) => setD({ ...d, travel })}
          empty="No travel recorded."
          addLabel="Add travel"
          add={() => ({ id: rid(), country: "", year: new Date().getFullYear() })}
          render={(r, set) => (
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Country"><Input required value={r.country} onChange={(x) => set({ country: x.target.value })} /></Field>
              <Field label="Year"><Input type="number" required value={r.year} onChange={(x) => set({ year: Number(x.target.value) })} /></Field>
              <Field label="Purpose"><Input value={r.purpose ?? ""} onChange={(x) => set({ purpose: x.target.value })} /></Field>
            </div>
          )}
        />
      </Section>

      {mode === "staff" && (
        <Section title="Internal notes" description="Staff only — never shown in the student portal.">
          <Textarea value={d.internalNotes ?? ""} onChange={(x) => setD({ ...d, internalNotes: x.target.value })} />
        </Section>
      )}

      <Card>
        <CardContent className="p-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={d.consentGiven} onChange={(x) => setD({ ...d, consentGiven: x.target.checked })} required={mode === "intake"} />
            <span><strong>Consent{mode === "staff" ? " (confirmed by the student)" : ""}:</strong> {consentText}</span>
          </label>
        </CardContent>
      </Card>
      <div><Button disabled={pending}>{pending ? "Saving…" : mode === "intake" ? "Submit my details" : "Save profile"}</Button></div>
    </form>
  );
}
