"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe, Quote } from "lucide-react";
import type { Programme, ProgrammeSourceField } from "@/domain/types";
import { importProgrammeAction } from "@/server/actions";
import type { ProgrammeDraft } from "@/server/services/programme-sources";
import { ActionForm, SubmitButton } from "./action-form";
import { ProgrammeForm } from "./programme-form";
import { Alert, Badge, Field, Input, Table, Td, Th } from "./ui/primitives";

const LABELS: Record<ProgrammeSourceField, string> = {
  universityName: "University", city: "City", name: "Programme", level: "Level", field: "Field", minCGPA4: "Min CGPA (4.0)", minGermanGrade: "Min German grade",
  ielts: "IELTS", pte: "PTE", duolingo: "Duolingo", moiAccepted: "MOI accepted", germanLevel: "German level", tuitionPerYear: "Tuition / year", currency: "Currency",
  durationMonths: "Duration (months)", intakeLabel: "Intake", intakeStart: "Intake start", intakeDeadline: "Application deadline",
};

function draftDefaults(d: ProgrammeDraft): Partial<Programme> {
  const v = d.values;
  return {
    universityName: v.universityName as string | undefined,
    country: d.country ?? undefined,
    city: v.city as string | undefined,
    name: v.name as string | undefined,
    level: v.level as Programme["level"] | undefined,
    field: v.field as string | undefined,
    keywords: v.field ? String(v.field).toLowerCase().split(/[\s,&/]+/).filter((k) => k.length > 2) : [],
    minCGPA4: v.minCGPA4 as number | undefined,
    minGermanGrade: v.minGermanGrade as number | undefined,
    english: { ielts: v.ielts as number | undefined, pte: v.pte as number | undefined, duolingo: v.duolingo as number | undefined, moiAccepted: v.moiAccepted === true, germanLevel: v.germanLevel as string | undefined },
    tuitionPerYear: v.tuitionPerYear as number | undefined,
    currency: v.currency as Programme["currency"] | undefined,
    durationMonths: v.durationMonths as number | undefined,
    intakes: v.intakeLabel || v.intakeStart || v.intakeDeadline ? [{ label: String(v.intakeLabel ?? ""), startDate: String(v.intakeStart ?? ""), applicationDeadline: String(v.intakeDeadline ?? "") }] : [],
    active: true,
  };
}

export function ProgrammeImport() {
  const [draft, setDraft] = React.useState<ProgrammeDraft | null>(null);
  const [extra, setExtra] = React.useState(0);
  const router = useRouter();
  const fromPage = React.useMemo(() => new Set(Object.keys(draft?.values ?? {})), [draft]);

  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={importProgrammeAction} onSuccess={(r) => setDraft((r.data?.draft as ProgrammeDraft) ?? null)}>
        <p className="text-sm text-muted-foreground">
          Paste the link to the programme on the university&apos;s <strong>official website</strong>. VisaGuard reads the page and fills in the requirements, each with the exact sentence it came from. You check them and save. Every night the page is read again, and if the university changes anything you get an alert.
        </p>
        <Field label="Official programme page" hint="e.g. https://www.university.ac.uk/courses/msc-data-science">
          <Input name="url" type="url" required placeholder="https://" />
        </Field>
        {Array.from({ length: extra }, (_, k) => (
          <Field key={k} label={`Extra official page ${k + 1}`} hint="e.g. the entry-requirements, international fees or Pakistan country page">
            <Input name="url" type="url" placeholder="https://" />
          </Field>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingText="Reading the official page…"><Globe /> Read official page</SubmitButton>
          {extra < 2 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExtra(extra + 1)}>+ add another official page (requirements / fees)</button>}
        </div>
      </ActionForm>

      {draft && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Read from the official page</span>
            <Badge tone="blue">{draft.sourceLabel}</Badge>
            {draft.urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                {new URL(u).hostname} <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
          {draft.warnings.length > 0 && <Alert tone="amber" title="Check before saving"><ul className="list-disc space-y-0.5 pl-5 text-xs">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
          {draft.notes.length > 0 && <Alert tone="blue" title="Notes from the page"><ul className="list-disc space-y-0.5 pl-5 text-xs">{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert>}
          {draft.missing.length > 0 && <Alert tone="neutral">Not found on the page, enter yourself: {draft.missing.map((m) => LABELS[m]).join(", ")}.</Alert>}
          {Object.keys(draft.values).length > 0 && (
            <Table>
              <thead><tr><Th>Field</Th><Th>Value</Th><Th>Proof from the official page</Th></tr></thead>
              <tbody>
                {(Object.keys(draft.values) as ProgrammeSourceField[]).map((k) => (
                  <tr key={k}>
                    <Td className="text-xs font-medium">{LABELS[k]}</Td>
                    <Td className="text-xs tabular-nums">{String(draft.values[k])}{draft.confidence[k] === "low" && <Badge tone="amber" className="ml-1">check</Badge>}</Td>
                    <Td className="max-w-[28rem] text-[11px] text-muted-foreground"><Quote className="mr-1 inline size-3" />{draft.evidence[k]}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <ProgrammeForm key={draft.sourceToken} defaults={draftDefaults(draft)} fromPage={fromPage} sourceToken={draft.sourceToken} onSaved={() => { setDraft(null); router.refresh(); }} />
        </div>
      )}
    </div>
  );
}
