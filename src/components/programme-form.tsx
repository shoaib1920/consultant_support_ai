"use client";

import type { Programme } from "@/domain/types";
import { upsertProgrammeAction } from "@/server/actions";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Select } from "./ui/primitives";

/**
 * Add/edit a programme. `defaults` pre-fills a new programme (e.g. from an official-page import);
 * `fromPage` marks the fields that were read from the page, and `sourceToken` carries the signed
 * import so the saved programme keeps its official source.
 */
export function ProgrammeForm({ programme, defaults, fromPage, sourceToken, onSaved }: { programme?: Programme; defaults?: Partial<Programme>; fromPage?: Set<string>; sourceToken?: string; onSaved?: () => void }) {
  const p = programme ?? defaults;
  const i = p?.intakes?.[0];
  const hl = (name: string) => (fromPage?.has(name) ? "border-green/60 bg-green-soft/50" : undefined);
  const body = (
    <ActionForm action={upsertProgrammeAction.bind(null, programme?.id ?? null)} onSuccess={onSaved} className={programme ? "mt-2 w-[32rem] max-w-[90vw] gap-2 rounded-md border bg-card p-3" : undefined}>
      {sourceToken && <input type="hidden" name="sourceToken" value={sourceToken} />}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="University"><Input name="universityName" required defaultValue={p?.universityName} className={hl("universityName")} /></Field>
        <Field label="Country"><Select name="country" defaultValue={p?.country ?? "UK"}><option value="UK">UK</option><option value="DE">Germany</option><option value="IT">Italy</option><option value="FR">France</option></Select></Field>
        <Field label="City"><Input name="city" required defaultValue={p?.city} className={hl("city")} /></Field>
        <Field label="Programme" className="sm:col-span-2"><Input name="name" required defaultValue={p?.name} className={hl("name")} /></Field>
        <Field label="Level"><Select name="level" defaultValue={p?.level ?? "master"} className={hl("level")}><option value="foundation">Foundation</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="phd">PhD</option></Select></Field>
        <Field label="Field"><Input name="field" required defaultValue={p?.field} className={hl("field")} /></Field>
        <Field label="Keywords (comma)" className="sm:col-span-2"><Input name="keywords" defaultValue={p?.keywords?.join(",")} /></Field>
        <Field label="Min CGPA (4.0)"><Input name="minCGPA4" type="number" step="0.01" defaultValue={p?.minCGPA4} className={hl("minCGPA4")} /></Field>
        <Field label="Min German grade"><Input name="minGermanGrade" type="number" step="0.1" defaultValue={p?.minGermanGrade} className={hl("minGermanGrade")} /></Field>
        <Field label="IELTS"><Input name="ielts" type="number" step="0.5" defaultValue={p?.english?.ielts} className={hl("ielts")} /></Field>
        <Field label="PTE"><Input name="pte" type="number" defaultValue={p?.english?.pte} className={hl("pte")} /></Field>
        <Field label="Duolingo"><Input name="duolingo" type="number" defaultValue={p?.english?.duolingo} className={hl("duolingo")} /></Field>
        <Field label="German level"><Input name="germanLevel" defaultValue={p?.english?.germanLevel} className={hl("germanLevel")} /></Field>
        <Field label="Tuition / year"><Input name="tuitionPerYear" type="number" required defaultValue={p?.tuitionPerYear} className={hl("tuitionPerYear")} /></Field>
        <Field label="Currency"><Select name="currency" defaultValue={p?.currency ?? "GBP"} className={hl("currency")}><option>GBP</option><option>EUR</option><option>USD</option></Select></Field>
        <Field label="Duration (months)"><Input name="durationMonths" type="number" required defaultValue={p?.durationMonths ?? 12} className={hl("durationMonths")} /></Field>
        <Field label="Intake (YYYY-MM)"><Input name="intakeLabel" required pattern="\d{4}-\d{2}" defaultValue={i?.label} className={hl("intakeLabel")} /></Field>
        <Field label="Intake start"><Input name="intakeStart" type="date" required defaultValue={i?.startDate} className={hl("intakeStart")} /></Field>
        <Field label="Application deadline"><Input name="intakeDeadline" type="date" required defaultValue={i?.applicationDeadline} className={hl("intakeDeadline")} /></Field>
        <Field label="Compliance notes" className="sm:col-span-3"><Input name="complianceNotes" defaultValue={p?.complianceNotes} /></Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="inLondon" defaultChecked={p?.inLondon} /> London</label>
        <label className={cn("flex items-center gap-1.5", fromPage?.has("moiAccepted") && "font-medium text-green")}><input type="checkbox" name="moiAccepted" defaultChecked={p?.english?.moiAccepted} /> MOI accepted</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Active</label>
      </div>
      <div><SubmitButton size="sm">{programme ? "Save" : sourceToken ? "Save programme from official page" : "Add programme"}</SubmitButton></div>
    </ActionForm>
  );
  return programme ? <details><summary className="cursor-pointer text-xs text-primary">Edit</summary>{body}</details> : body;
}
