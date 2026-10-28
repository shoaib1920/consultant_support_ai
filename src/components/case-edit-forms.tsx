"use client";

import * as React from "react";
import type { AttestationStep, Case, CountryCheckState, IrreversibleAction, Stage } from "@/domain/types";
import {
  attestationAction,
  casAction,
  cancelPreflightAction,
  confirmPreflightAction,
  countryCheckAction,
  overrideAction,
  paymentStatusAction,
  receiptAction,
  recordPaymentAction,
  startPreflightAction,
  transitionAction,
} from "@/server/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { Alert, Field, Input, Select, Textarea } from "./ui/primitives";

export function AttestationStepForm({ caseId, attestationId, step }: { caseId: string; attestationId: string; step: AttestationStep }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary">Update</summary>
      <ActionForm action={attestationAction.bind(null, caseId)} className="mt-2 w-64 gap-2 rounded-md border bg-card p-2">
        <input type="hidden" name="attestationId" value={attestationId} />
        <input type="hidden" name="authority" value={step.authority} />
        <Select name="status" defaultValue={step.status} className="h-8 text-xs">
          {["not_started", "submitted", "in_progress", "completed", "rejected", "not_required"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </Select>
        <Field label="Submitted"><Input type="date" name="submittedAt" defaultValue={step.submittedAt} className="h-8 text-xs" /></Field>
        <Field label="Completed"><Input type="date" name="completedAt" defaultValue={step.completedAt} className="h-8 text-xs" /></Field>
        <Input name="reference" placeholder="Reference no." defaultValue={step.reference} className="h-8 text-xs" />
        <SubmitButton size="sm">Save</SubmitButton>
      </ActionForm>
    </details>
  );
}

export function CountryCheckForm({ caseId, checkKey, state }: { caseId: string; checkKey: string; state?: CountryCheckState }) {
  return (
    <ActionForm action={countryCheckAction.bind(null, caseId)} className="gap-2">
      <input type="hidden" name="key" value={checkKey} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_9rem_1fr_auto]">
        <Select name="status" defaultValue={state?.status ?? "not_started"} className="h-8 text-xs" aria-label="Status">
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="not_required">Not required</option>
        </Select>
        <Input type="date" name="date" defaultValue={state?.date} className="h-8 text-xs" aria-label="Date" />
        <Input name="reference" placeholder="Reference / note" defaultValue={state?.reference ?? state?.note} className="h-8 text-xs" />
        <SubmitButton size="sm" variant="outline">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CasForm({ kase }: { kase: Case }) {
  return (
    <ActionForm action={casAction.bind(null, kase.id)}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name on CAS"><Input name="name" defaultValue={kase.cas?.name} /></Field>
        <Field label="Course on CAS"><Input name="course" defaultValue={kase.cas?.course} /></Field>
        <Field label="Tuition on CAS"><Input name="tuitionFee" type="number" defaultValue={kase.cas?.tuitionFee} /></Field>
        <Field label="Course start on CAS"><Input name="startDate" type="date" defaultValue={kase.cas?.startDate} /></Field>
      </div>
      <div><SubmitButton size="sm" variant="outline">Save CAS details</SubmitButton></div>
    </ActionForm>
  );
}

export function TransitionForm({ caseId, to }: { caseId: string; to: Stage }) {
  return (
    <ActionForm action={transitionAction.bind(null, caseId)}>
      <input type="hidden" name="to" value={to} />
      {to === "Offer/Admission" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Offer type"><Select name="offerType" defaultValue="conditional"><option value="conditional">Conditional</option><option value="unconditional">Unconditional</option></Select></Field>
          <Field label="Received"><Input type="date" name="offerDate" required /></Field>
          <Field label="Reference"><Input name="offerRef" /></Field>
        </div>
      )}
      {to === "Decision" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Outcome"><Select name="outcome"><option value="approved">Approved</option><option value="refused">Refused</option><option value="withdrawn">Withdrawn</option></Select></Field>
          <Field label="Date"><Input type="date" name="decisionDate" required /></Field>
          <Field label="Refusal reason (for analytics)"><Input name="decisionReason" /></Field>
        </div>
      )}
      <div><SubmitButton>Move to “{to}”</SubmitButton></div>
    </ActionForm>
  );
}

const PAYMENT_TYPES = [
  ["application_fee", "Application fee"],
  ["tuition_deposit", "Tuition deposit"],
  ["visa_fee", "Visa fee"],
  ["ihs", "Immigration Health Surcharge (UK)"],
  ["insurance", "Insurance"],
  ["blocked_account", "Blocked account transfer"],
  ["attestation_fee", "Attestation fee"],
  ["consultancy_fee", "Consultancy fee"],
  ["courier", "Courier"],
  ["other", "Other"],
] as const;

export function PreflightForm({ caseId, action, label, defaultType }: { caseId: string; action: IrreversibleAction; label: string; defaultType: string }) {
  const [refundable, setRefundable] = React.useState("no");
  return (
    <ActionForm action={startPreflightAction.bind(null, caseId)}>
      <input type="hidden" name="action" value={action} />
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Payment type">
          <Select name="type" defaultValue={defaultType}>{PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label={action === "pay_fee" ? "Amount" : "Amount (if any)"}><Input name="amount" type="number" step="0.01" min={0} required={action === "pay_fee"} /></Field>
        <Field label="Currency"><Select name="currency" defaultValue="GBP"><option>GBP</option><option>EUR</option><option>PKR</option><option>USD</option></Select></Field>
        <Field label="Refundable?">
          <Select name="refundable" value={refundable} onChange={(e) => setRefundable(e.target.value)}><option value="no">No — non-refundable</option><option value="yes">Yes — refundable</option></Select>
        </Field>
        <Field label="Payee / description" className="sm:col-span-4"><Input name="payee" placeholder="e.g. University application portal" /></Field>
      </div>
      {refundable === "no" && <Alert tone="red">Money at risk: this payment cannot be recovered if the application fails.</Alert>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewedWarnings" required className="mt-1" /> I have read every open warning above and the rule verification status.</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="checkedAmount" required className="mt-1" /> I checked the amount, currency and refundability against the official invoice.</label>
      <div><SubmitButton pendingText="Checking gates…">Officer confirm: {label}</SubmitButton></div>
    </ActionForm>
  );
}

export function ConfirmPreflightForm({ caseId, approvalId, nonRefundable }: { caseId: string; approvalId: string; nonRefundable: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <ActionForm action={confirmPreflightAction.bind(null, caseId, approvalId)}>
        {nonRefundable && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="understandsNonRefundable" required className="mt-1" /> I understand this money is non-refundable and I approve it as Manager.</label>}
        <div><SubmitButton variant="destructive" pendingText="Re-checking gates & executing…">Manager confirm & execute</SubmitButton></div>
      </ActionForm>
      <ActionForm action={cancelPreflightAction.bind(null, caseId, approvalId)}>
        <div className="flex gap-2"><Input name="reason" placeholder="Reason for cancelling" className="h-8 text-xs" /><SubmitButton size="sm" variant="outline">Cancel pre-flight</SubmitButton></div>
      </ActionForm>
    </div>
  );
}

export function OverrideForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={overrideAction.bind(null, caseId)}>
      <Field label="Written reason (min. 30 characters) — stored permanently in the audit log">
        <Textarea name="reason" required minLength={30} placeholder="e.g. University confirmed in writing (email 12 Oct, attached) that the 2.45 CGPA is accepted with 2 years' relevant work experience…" />
      </Field>
      <div><SubmitButton variant="destructive">Grant manager override</SubmitButton></div>
    </ActionForm>
  );
}

export function RefundablePaymentForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={recordPaymentAction.bind(null, caseId)} resetOnSuccess>
      <input type="hidden" name="refundable" value="yes" />
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_6rem_1fr_auto] sm:items-end">
        <Field label="Type"><Select name="type" defaultValue="consultancy_fee">{PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Amount"><Input name="amount" type="number" step="0.01" min={0} required /></Field>
        <Field label="Currency"><Select name="currency" defaultValue="PKR"><option>PKR</option><option>GBP</option><option>EUR</option><option>USD</option></Select></Field>
        <Field label="Description"><Input name="payee" /></Field>
        <SubmitButton>Record refundable payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaymentRowActions({ caseId, paymentId, refundable }: { caseId: string; paymentId: string; refundable: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <ActionForm action={paymentStatusAction.bind(null, caseId, paymentId)} className="gap-1">
        <div className="flex gap-1">
          <Select name="status" className="h-7 w-28 text-xs" defaultValue="paid">
            <option value="paid">Paid</option>
            {refundable && <option value="refunded">Refunded</option>}
            <option value="void">Void</option>
          </Select>
          <SubmitButton size="sm" variant="outline">Set</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={receiptAction.bind(null, caseId, paymentId)} className="gap-1">
        <div className="flex gap-1"><Input type="file" name="file" className="h-7 text-[11px]" accept="application/pdf,image/*" required /><SubmitButton size="sm" variant="outline">Receipt</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
