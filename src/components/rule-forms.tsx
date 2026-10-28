"use client";

import type { Rule } from "@/domain/types";
import { createRuleAction, updateRuleAction } from "@/server/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Select, Textarea } from "./ui/primitives";

export function RuleEditForm({ rule, canVerify }: { rule: Rule; canVerify: boolean }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary">Edit</summary>
      <ActionForm action={updateRuleAction.bind(null, rule.id)} className="mt-2 w-80 gap-2 rounded-md border bg-card p-3">
        <Field label="Label"><Input name="label" defaultValue={rule.label} className="h-8 text-xs" /></Field>
        <Field label={`Value (${typeof rule.value})`}>
          {typeof rule.value === "boolean" ? (
            <Select name="value" defaultValue={String(rule.value)} className="h-8 text-xs"><option value="true">true / required</option><option value="false">false / not required</option></Select>
          ) : typeof rule.value === "number" ? (
            <Input name="value" type="number" step="any" defaultValue={rule.value} className="h-8 text-xs" />
          ) : (
            <Textarea name="value" defaultValue={rule.value} className="text-xs" />
          )}
        </Field>
        <Field label="Unit"><Input name="unit" defaultValue={rule.unit} className="h-8 text-xs" /></Field>
        <Field label="Official source URL"><Input name="sourceUrl" type="url" defaultValue={rule.sourceUrl} className="h-8 text-xs" /></Field>
        <Field label="Source note"><Input name="sourceNote" defaultValue={rule.sourceNote} className="h-8 text-xs" /></Field>
        <Field label="Status" hint={canVerify ? "Setting Verified stamps today's date and your name." : "Only managers can verify; your edit will be saved as Unverified."}>
          <Select name="status" defaultValue={canVerify ? rule.status : "Unverified"} className="h-8 text-xs">
            {canVerify && <option>Verified</option>}
            <option>Unverified</option>
            <option>Conflicting</option>
          </Select>
        </Field>
        <Field label="Notes"><Textarea name="notes" defaultValue={rule.notes} className="text-xs" /></Field>
        <Field label="Reason for change (changelog)"><Input name="reason" required minLength={5} className="h-8 text-xs" /></Field>
        <SubmitButton size="sm">Save rule</SubmitButton>
      </ActionForm>
    </details>
  );
}

export function RuleCreateForm() {
  return (
    <ActionForm action={createRuleAction} resetOnSuccess>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Country"><Select name="country"><option value="UK">UK</option><option value="DE">Germany</option><option value="IT">Italy</option><option value="FR">France</option><option value="*">Global</option></Select></Field>
        <Field label="Level"><Select name="level"><option value="*">All levels</option><option value="bachelor">Bachelor</option><option value="master">Master</option><option value="phd">PhD</option><option value="foundation">Foundation</option></Select></Field>
        <Field label="Intake / AY" hint="* or e.g. 2027-28"><Input name="intake" defaultValue="*" /></Field>
        <Field label="Key"><Input name="key" required placeholder="funds.maintenance_monthly_london" /></Field>
        <Field label="Label" className="sm:col-span-2"><Input name="label" required /></Field>
        <Field label="Value type"><Select name="valueType"><option value="number">Number</option><option value="string">Text / date</option><option value="boolean">Yes/No</option></Select></Field>
        <Field label="Value"><Input name="value" required /></Field>
        <Field label="Unit"><Input name="unit" /></Field>
        <Field label="Official source URL" className="sm:col-span-3"><Input name="sourceUrl" type="url" required /></Field>
        <Field label="Notes" className="sm:col-span-4"><Input name="notes" /></Field>
      </div>
      <div><SubmitButton>Create rule (Unverified)</SubmitButton></div>
    </ActionForm>
  );
}
