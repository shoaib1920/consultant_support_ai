"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { analyzeDocAction, analyzeManualAction } from "@/server/actions";
import type { ActionResult } from "@/server/actions/result";
import { ActionForm, ResultMessage, SubmitButton } from "./action-form";
import { Button, Field, Input, Select } from "./ui/primitives";

interface Exp { date: string; amount: string; note: string }

function Explanations({ value, onChange }: { value: Exp[]; onChange: (v: Exp[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-medium text-muted-foreground">Verified source-of-funds explanations for large deposits (staff-checked evidence only)</div>
      {value.map((e, i) => (
        <div key={i} className="grid grid-cols-[9rem_8rem_1fr_auto] gap-1">
          <Input type="date" value={e.date} onChange={(ev) => onChange(value.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)))} className="h-8 text-xs" />
          <Input type="number" placeholder="Amount" value={e.amount} onChange={(ev) => onChange(value.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))} className="h-8 text-xs" />
          <Input placeholder="Evidence checked (e.g. plot sale deed #123, verified original)" value={e.note} onChange={(ev) => onChange(value.map((x, j) => (j === i ? { ...x, note: ev.target.value } : x)))} className="h-8 text-xs" />
          <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div><Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, { date: "", amount: "", note: "" }])}><Plus /> Add explanation</Button></div>
    </div>
  );
}

export function AnalyzeDocForm({ caseId, docs, defaultDate }: { caseId: string; docs: { id: string; name: string }[]; defaultDate: string }) {
  const [exps, setExps] = React.useState<Exp[]>([]);
  return (
    <ActionForm action={analyzeDocAction.bind(null, caseId)}>
      <input type="hidden" name="explanations" value={JSON.stringify(exps.filter((e) => e.date && e.amount && e.note).map((e) => ({ ...e, amount: Number(e.amount) })))} />
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Bank statement (AI-extracted transactions)">
          <Select name="documentId" required>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
        <Field label="Visa application date"><Input type="date" name="applicationDate" defaultValue={defaultDate} required /></Field>
        <SubmitButton pendingText="Analysing…">Analyse statement</SubmitButton>
      </div>
      <Explanations value={exps} onChange={setExps} />
    </ActionForm>
  );
}

interface Row { date: string; description: string; amount: string; balance: string }

export function ManualStatementForm({ caseId, defaultDate }: { caseId: string; defaultDate: string }) {
  const [rows, setRows] = React.useState<Row[]>([{ date: "", description: "", amount: "", balance: "" }]);
  const [meta, setMeta] = React.useState({ currency: "PKR", accountHolder: "", bankName: "", openingBalance: "", statementStart: "", statementEnd: "", applicationDate: defaultDate });
  const [exps, setExps] = React.useState<Exp[]>([]);
  const [res, setRes] = React.useState<ActionResult | null>(null);
  const [pending, start] = React.useTransition();
  const upd = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const payload = {
            ...meta,
            openingBalance: Number(meta.openingBalance),
            transactions: rows.filter((r) => r.date).map((r) => ({ date: r.date, description: r.description || "—", amount: Number(r.amount), balance: Number(r.balance) })),
            explanations: exps.filter((x) => x.date && x.amount && x.note).map((x) => ({ ...x, amount: Number(x.amount) })),
          };
          setRes(await analyzeManualAction(caseId, JSON.stringify(payload)));
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Currency"><Select value={meta.currency} onChange={(e) => setMeta({ ...meta, currency: e.target.value })}><option>PKR</option><option>GBP</option><option>EUR</option><option>USD</option></Select></Field>
        <Field label="Account holder"><Input value={meta.accountHolder} onChange={(e) => setMeta({ ...meta, accountHolder: e.target.value })} /></Field>
        <Field label="Bank"><Input value={meta.bankName} onChange={(e) => setMeta({ ...meta, bankName: e.target.value })} /></Field>
        <Field label="Opening balance"><Input type="number" required value={meta.openingBalance} onChange={(e) => setMeta({ ...meta, openingBalance: e.target.value })} /></Field>
        <Field label="Statement start"><Input type="date" required value={meta.statementStart} onChange={(e) => setMeta({ ...meta, statementStart: e.target.value })} /></Field>
        <Field label="Statement end"><Input type="date" required value={meta.statementEnd} onChange={(e) => setMeta({ ...meta, statementEnd: e.target.value })} /></Field>
        <Field label="Visa application date"><Input type="date" required value={meta.applicationDate} onChange={(e) => setMeta({ ...meta, applicationDate: e.target.value })} /></Field>
      </div>
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[9rem_1fr_8rem_8rem_auto] gap-1 text-[11px] text-muted-foreground"><span>Date</span><span>Description</span><span>Amount (+/−)</span><span>Balance after</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[9rem_1fr_8rem_8rem_auto] gap-1">
            <Input type="date" value={r.date} onChange={(e) => upd(i, "date", e.target.value)} className="h-8 text-xs" />
            <Input value={r.description} onChange={(e) => upd(i, "description", e.target.value)} className="h-8 text-xs" />
            <Input type="number" value={r.amount} onChange={(e) => upd(i, "amount", e.target.value)} className="h-8 text-xs" />
            <Input type="number" value={r.balance} onChange={(e) => upd(i, "balance", e.target.value)} className="h-8 text-xs" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <div><Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { date: "", description: "", amount: "", balance: "" }])}><Plus /> Add transaction</Button></div>
      </div>
      <Explanations value={exps} onChange={setExps} />
      <div><Button disabled={pending}>{pending ? "Analysing…" : "Analyse manual statement"}</Button></div>
      <ResultMessage state={res} />
    </form>
  );
}

