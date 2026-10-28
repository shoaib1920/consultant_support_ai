"use client";

import * as React from "react";
import type { Case, Programme, StudyLevel, User } from "@/domain/types";
import { COUNTRIES, COUNTRY_CODES } from "@/domain/countries";
import { createCaseAction, updateCaseAction } from "@/server/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { Card, CardContent, Field, Input, Select } from "./ui/primitives";

export function CaseForm({ studentId, programmes, officers, defaultLevel, preselect, existing }: { studentId: string; programmes: Programme[]; officers: User[]; defaultLevel: StudyLevel; preselect?: string; existing?: Case }) {
  const [pid, setPid] = React.useState(preselect ?? existing?.programmeId ?? "");
  const p = programmes.find((x) => x.id === pid);
  const intake = p?.intakes.find((i) => i.applicationDeadline >= new Date().toISOString().slice(0, 10)) ?? p?.intakes[0];
  const k = pid || "manual"; // re-mount fields with new defaults when the programme changes
  const action = existing ? updateCaseAction.bind(null, existing.id) : createCaseAction;
  const v = <T,>(fromCase: T | undefined, fromProg: T | undefined) => (existing ? fromCase : fromProg);
  return (
    <ActionForm action={action}>
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <input type="hidden" name="studentId" value={studentId} />
          {!existing && (
            <Field label="Programme (from database)" className="sm:col-span-2">
              <Select name="programmeId" value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="">— Enter manually —</option>
                {COUNTRY_CODES.map((c) => (
                  <optgroup key={c} label={COUNTRIES[c].name}>
                    {programmes.filter((x) => x.country === c).map((x) => (
                      <option key={x.id} value={x.id}>{x.universityName} — {x.name}{x.sampleData ? " (sample)" : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}
          <div key={k} className="contents">
            {!existing && (
              <Field label="Country">
                <Select name="country" defaultValue={p?.country ?? "UK"}>
                  {COUNTRY_CODES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Level">
              <Select name="level" defaultValue={v(existing?.level, p?.level) ?? defaultLevel}>
                <option value="foundation">Foundation</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="phd">PhD</option>
              </Select>
            </Field>
            <Field label="University"><Input name="universityName" required defaultValue={v(existing?.universityName, p?.universityName)} /></Field>
            <Field label="Programme"><Input name="programmeName" required defaultValue={v(existing?.programmeName, p?.name)} /></Field>
            <Field label="Field (for course-alignment check)"><Input name="programmeField" defaultValue={v(existing?.programmeField, p?.field)} /></Field>
            <Field label="City"><Input name="city" defaultValue={v(existing?.city, p?.city)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inLondon" defaultChecked={!!v(existing?.inLondon, p?.inLondon)} /> Studying in London (UK maintenance rate)</label>
            <div />
            <Field label="Intake (YYYY-MM)"><Input name="intake" required pattern="\d{4}-\d{2}" defaultValue={v(existing?.intake, intake?.label)} /></Field>
            <Field label="Intake start date"><Input name="intakeStartDate" type="date" required defaultValue={v(existing?.intakeStartDate, intake?.startDate)} /></Field>
            <Field label="University application deadline"><Input name="applicationDeadline" type="date" defaultValue={v(existing?.applicationDeadline, intake?.applicationDeadline)} /></Field>
            <Field label="Planned visa application date" hint="Used for the funds window and attestation deadlines."><Input name="plannedVisaApplicationDate" type="date" defaultValue={existing?.plannedVisaApplicationDate} /></Field>
            <Field label="Course length (months)"><Input name="courseMonths" type="number" min={1} max={72} required defaultValue={v(existing?.courseMonths, p?.durationMonths) ?? 12} /></Field>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Field label="Total tuition"><Input name="tuitionAmount" type="number" step="0.01" min={0} required defaultValue={v(existing?.tuitionFee.amount, p ? Math.round(p.tuitionPerYear * Math.max(1, p.durationMonths / 12)) : undefined)} /></Field>
              <Field label="Currency">
                <Select name="tuitionCurrency" defaultValue={v(existing?.tuitionFee.currency, p?.currency) ?? "GBP"}><option>GBP</option><option>EUR</option><option>USD</option><option>PKR</option></Select>
              </Field>
            </div>
            <Field label="Tuition already paid"><Input name="tuitionPaid" type="number" step="0.01" min={0} defaultValue={existing?.tuitionPaid ?? 0} /></Field>
            <Field label="Min CGPA (4.0 scale)"><Input name="minCGPA4" type="number" step="0.01" min={0} max={4} defaultValue={v(existing?.minCGPA4, p?.minCGPA4)} /></Field>
            <Field label="Min German grade (DE, 1.0 best)"><Input name="minGermanGrade" type="number" step="0.1" min={1} max={4} defaultValue={v(existing?.minGermanGrade, p?.minGermanGrade)} /></Field>
            <Field label="IELTS minimum"><Input name="ielts" type="number" step="0.5" min={0} max={9} defaultValue={v(existing?.englishRequirement?.ielts, p?.english.ielts)} /></Field>
            <Field label="PTE minimum"><Input name="pte" type="number" min={0} max={90} defaultValue={v(existing?.englishRequirement?.pte, p?.english.pte)} /></Field>
            <Field label="Duolingo minimum"><Input name="duolingo" type="number" min={0} max={160} defaultValue={v(existing?.englishRequirement?.duolingo, p?.english.duolingo)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="moiAccepted" defaultChecked={!!v(existing?.englishRequirement?.moiAccepted, p?.english.moiAccepted)} /> MOI accepted by university</label>
            <Field label="Assigned officer">
              <Select name="assignedOfficerId" defaultValue={existing?.assignedOfficerId ?? ""}>
                <option value="">— Unassigned —</option>
                {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>
      <div><SubmitButton pendingText="Saving & assessing…">{existing ? "Save changes" : "Create case & run assessment"}</SubmitButton></div>
    </ActionForm>
  );
}
