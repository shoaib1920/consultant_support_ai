"use client";

import type { DocType, DocumentFlag } from "@/domain/types";
import { DOC_LABELS } from "@/domain/countries";
import { manualFieldsAction, resolveFlagAction, reviewDocAction, uploadAction } from "@/server/actions";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Select } from "./ui/primitives";

export function UploadForm({ studentId, caseId, types, defaultType, compact }: { studentId?: string; caseId?: string; types: DocType[]; defaultType?: DocType; compact?: boolean }) {
  return (
    <ActionForm action={uploadAction} resetOnSuccess className={compact ? "gap-2" : undefined}>
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      {caseId && <input type="hidden" name="caseId" value={caseId} />}
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label="Document type">
          <Select name="docType" defaultValue={defaultType ?? types[0]}>
            {types.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="File (PDF, JPG, PNG, WEBP · max 10 MB)">
          <Input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp,application/json,text/plain" />
        </Field>
        <SubmitButton pendingText="Uploading & reading…">Upload</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResolveFlagForm({ documentId, flag }: { documentId: string; flag: DocumentFlag }) {
  return (
    <ActionForm action={resolveFlagAction.bind(null, documentId, flag.id)} className="mt-1 gap-2">
      <div className="flex gap-2">
        <Input name="note" placeholder="What did you check? e.g. 'Compared original passport; spelling matches affidavit'" required minLength={10} />
        <SubmitButton size="sm" variant="outline">Resolve</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ReviewForm({ documentId }: { documentId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={reviewDocAction.bind(null, documentId)}>
        <input type="hidden" name="status" value="verified" />
        <input type="hidden" name="note" value="" />
        <SubmitButton size="sm">Mark verified</SubmitButton>
      </ActionForm>
      <ActionForm action={reviewDocAction.bind(null, documentId)}>
        <input type="hidden" name="status" value="rejected" />
        <div className="flex gap-2">
          <Input name="note" placeholder="Reason (shown to student)" className="h-8 w-56 text-xs" />
          <SubmitButton size="sm" variant="outline">Reject</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

export function FieldsEditor({ documentId, fields }: { documentId: string; fields: Record<string, string | number | boolean | null> }) {
  return (
    <ActionForm action={manualFieldsAction.bind(null, documentId)} className="gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(fields).map(([k, v]) => (
          <Field key={k} label={k}>
            <Input name={`f_${k}`} defaultValue={v == null ? "" : String(v)} className="h-8 text-xs" />
          </Field>
        ))}
        <Field label="Add field (key)"><Input name="newKey" placeholder="e.g. expiryDate" className="h-8 text-xs" /></Field>
        <Field label="Value"><Input name="newValue" className="h-8 text-xs" /></Field>
      </div>
      <div><SubmitButton size="sm" variant="outline">Save corrected fields</SubmitButton></div>
    </ActionForm>
  );
}
