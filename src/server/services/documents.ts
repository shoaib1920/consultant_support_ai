// Document vault: upload -> AI extraction -> single-doc checks -> cross-document consistency.
// AI never verifies. Only staff can mark a document verified, and only after resolving critical flags.

import { DOC_LABELS } from "@/domain/countries";
import { type DocFields, crossDocumentConsistency, documentChecks } from "@/domain/consistency";
import { addDays } from "@/domain/dates";
import type { Case, DocType, DocumentFlag, DocumentRecord, ExtractedFields, Student } from "@/domain/types";
import { AIError, checkRateLimit, getAI } from "../ai";
import { AuthError, can } from "../auth/rbac";
import type { Actor } from "../auth/session";
import { sha256 } from "../crypto";
import { type Repo, newId, nowISO } from "../db";
import { getFile, putFile } from "../storage";
import { audit } from "./audit";
import { NotFoundError } from "./bundle";
import { refreshStudentCases } from "./eligibility";
import { syncTasks } from "./tasks";

export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/json", "text/plain"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertStudentAccess(actor: Actor, studentId: string, perm: "doc.upload" | "doc.review") {
  if (actor.role === "student") {
    if (perm !== "doc.upload" || actor.studentId !== studentId) throw new AuthError("Students can only upload to their own file.");
    return;
  }
  if (!can(actor.role, perm)) throw new AuthError(`Your role cannot ${perm}.`);
}

export interface UploadInput {
  studentId: string;
  caseId?: string;
  docType: DocType;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export async function uploadDocument(repo: Repo, actor: Actor, input: UploadInput): Promise<DocumentRecord> {
  assertStudentAccess(actor, input.studentId, "doc.upload");
  if (!ALLOWED_MIME.includes(input.mimeType)) throw new ValidationError(`File type ${input.mimeType} is not allowed. Use PDF, JPG, PNG or WEBP.`);
  if (input.bytes.length === 0 || input.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError("File must be between 1 byte and 10 MB.");
  const student = await repo.get<Student>("students", input.studentId);
  if (!student || student.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  const id = newId("dc_");
  const safeName = input.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const storagePath = `orgs/${actor.organizationId}/students/${input.studentId}/${id}/${safeName}`;
  await putFile(storagePath, input.bytes, input.mimeType);
  const now = nowISO();
  const doc: DocumentRecord = {
    id,
    organizationId: actor.organizationId,
    createdAt: now,
    updatedAt: now,
    studentId: input.studentId,
    caseId: input.caseId,
    docType: input.docType,
    fileName: safeName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    storagePath,
    uploadedBy: actor.id,
    uploadedVia: actor.role === "student" ? "portal" : "staff",
    extractionStatus: "pending",
    flags: [],
    reviewStatus: "pending",
  };
  await repo.transaction(async (tx) => {
    await tx.set("documents", id, doc);
    await audit(tx, actor, { action: "document.uploaded", entity: "documents", entityId: id, caseId: input.caseId, after: { docType: doc.docType, fileName: doc.fileName, sizeBytes: doc.sizeBytes, via: doc.uploadedVia } });
  });
  await runExtraction(repo, actor, id, input.bytes);
  return (await repo.get<DocumentRecord>("documents", id))!;
}

export async function runExtraction(repo: Repo, actor: Actor, documentId: string, bytes?: Buffer) {
  const doc = await repo.get<DocumentRecord>("documents", documentId);
  if (!doc || doc.organizationId !== actor.organizationId) throw new NotFoundError("Document");
  const student = (await repo.get<Student>("students", doc.studentId))!;
  const data = bytes ?? (await getFile(doc.storagePath));
  if (!data) throw new NotFoundError("File");
  try {
    checkRateLimit(`ai:${actor.id}`);
    const out = await getAI().extract({ docType: doc.docType, bytes: data, mimeType: doc.mimeType, fileName: doc.fileName, student });
    const now = nowISO();
    const ef: ExtractedFields = {
      id: `ef_${documentId}`,
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      documentId,
      studentId: doc.studentId,
      docType: doc.docType,
      fields: out.fields,
      fieldConfidence: out.fieldConfidence,
      detectedDocType: out.detectedDocType,
      pagesDetected: out.pagesDetected,
      legible: out.legible,
      expiryDate: out.expiryDate,
      injectionSuspected: out.injectionSuspected,
      source: out.source,
      model: out.model,
      promptVersion: out.promptVersion,
      transactions: out.transactions.length ? out.transactions : undefined,
    };
    await repo.transaction(async (tx) => {
      await tx.set("extractedFields", ef.id, ef);
      await tx.update<DocumentRecord>("documents", documentId, { extractionStatus: "done", extractedFieldsId: ef.id, pageCount: out.pagesDetected, updatedAt: now });
      await audit(tx, actor, { action: "document.extracted", entity: "extractedFields", entityId: ef.id, caseId: doc.caseId, after: { fields: Object.keys(ef.fields), injectionSuspected: ef.injectionSuspected, transactions: out.transactions.length }, ai: { model: out.model, promptVersion: out.promptVersion, source: out.source } });
    });
  } catch (e) {
    const msg = e instanceof AIError || (e instanceof Error && e.name === "RateLimitError") ? e.message : "Extraction failed.";
    await repo.transaction(async (tx) => {
      await tx.update<DocumentRecord>("documents", documentId, {
        extractionStatus: "failed",
        flags: [...doc.flags.filter((f) => f.code !== "EXTRACTION_FAILED"), { id: `fl_${sha256(documentId + "EXTRACTION_FAILED").slice(0, 12)}`, severity: "warning", code: "EXTRACTION_FAILED", message: `${msg} Enter the key fields manually.`, needsManualVerification: true }],
        updatedAt: nowISO(),
      });
      await audit(tx, actor, { action: "document.extraction_failed", entity: "documents", entityId: documentId, caseId: doc.caseId, after: { error: msg } });
    });
  }
  await recomputeConsistency(repo, actor, doc.studentId);
}

export async function saveManualFields(repo: Repo, actor: Actor, documentId: string, fields: Record<string, string | number | null>) {
  assertStudentAccess(actor, "", "doc.review");
  const doc = await repo.get<DocumentRecord>("documents", documentId);
  if (!doc || doc.organizationId !== actor.organizationId) throw new NotFoundError("Document");
  const prev = await repo.get<ExtractedFields>("extractedFields", `ef_${documentId}`);
  const now = nowISO();
  const ef: ExtractedFields = {
    ...(prev ?? { id: `ef_${documentId}`, organizationId: actor.organizationId, createdAt: now, documentId, studentId: doc.studentId, docType: doc.docType, fieldConfidence: {} }),
    fields: { ...(prev?.fields ?? {}), ...fields },
    fieldConfidence: { ...(prev?.fieldConfidence ?? {}), ...Object.fromEntries(Object.keys(fields).map((k) => [k, "high" as const])) },
    source: "manual",
    updatedAt: now,
  } as ExtractedFields;
  await repo.transaction(async (tx) => {
    await tx.set("extractedFields", ef.id, ef);
    await tx.update<DocumentRecord>("documents", documentId, {
      extractionStatus: "manual",
      extractedFieldsId: ef.id,
      flags: doc.flags.filter((f) => f.code !== "EXTRACTION_FAILED"),
      updatedAt: now,
    });
    await audit(tx, actor, { action: "document.fields_edited", entity: "extractedFields", entityId: ef.id, caseId: doc.caseId, before: prev?.fields, after: ef.fields });
  });
  await recomputeConsistency(repo, actor, doc.studentId);
}

function flagId(docId: string, code: string, field?: string) {
  return `fl_${sha256(`${docId}|${code}|${field ?? ""}`).slice(0, 12)}`;
}

/** Recompute all flags for a student's documents, preserving human resolutions. */
export async function recomputeConsistency(repo: Repo, actor: Actor, studentId: string) {
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [student, docs, efs, cases] = await Promise.all([
    repo.get<Student>("students", studentId),
    repo.list<DocumentRecord>("documents", [org, ["studentId", "==", studentId]]),
    repo.list<ExtractedFields>("extractedFields", [org, ["studentId", "==", studentId]]),
    repo.list<Case>("cases", [org, ["studentId", "==", studentId]]),
  ]);
  if (!student) return;
  const primary = cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const courseEnd = primary ? addDays(primary.intakeStartDate, Math.round(primary.courseMonths * 30.4)) : undefined;
  const live = docs.filter((d) => d.reviewStatus !== "rejected");
  const fieldsByDoc: DocFields[] = live
    .map((d) => {
      const ef = efs.find((e) => e.documentId === d.id);
      return ef ? { documentId: d.id, docType: d.docType, label: `${DOC_LABELS[d.docType]} (${d.fileName})`, fields: ef.fields, detectedDocType: ef.detectedDocType, pagesDetected: ef.pagesDetected, legible: ef.legible, expiryDate: ef.expiryDate, injectionSuspected: ef.injectionSuspected } : null;
    })
    .filter(Boolean) as DocFields[];
  const cross = crossDocumentConsistency(student, fieldsByDoc, primary ? { universityName: primary.universityName, programmeName: primary.programmeName, tuitionFee: primary.tuitionFee.amount, intakeStartDate: primary.intakeStartDate } : {});

  await repo.transaction(async (tx) => {
    for (const d of live) {
      const f = fieldsByDoc.find((x) => x.documentId === d.id);
      const next: DocumentFlag[] = [];
      let completeness = d.completeness;
      if (f) {
        const chk = documentChecks(f, { courseEndDate: courseEnd });
        completeness = { allPages: chk.allPages, legible: chk.legible, notExpired: chk.notExpired, correctType: chk.correctType, notes: chk.notes };
        for (const fl of chk.flags) next.push({ ...fl, id: flagId(d.id, fl.code, fl.field) });
      }
      for (const c of cross.filter((x) => x.documentIds[0] === d.id)) {
        next.push({ id: flagId(d.id, c.code, c.field), severity: c.severity, code: c.code, message: c.message, field: c.field, relatedDocumentIds: c.documentIds, needsManualVerification: c.severity !== "info" });
      }
      for (const keep of d.flags.filter((x) => x.code === "EXTRACTION_FAILED" && d.extractionStatus === "failed")) next.push(keep);
      // carry over human resolutions
      for (const n of next) {
        const old = d.flags.find((o) => o.id === n.id);
        if (old?.resolved) n.resolved = old.resolved;
      }
      const openManual = next.some((n) => n.needsManualVerification && !n.resolved);
      const reviewStatus = d.reviewStatus === "verified" && next.some((n) => n.severity === "critical" && !n.resolved) ? "needs_manual_verification" : d.reviewStatus === "pending" && openManual ? "needs_manual_verification" : d.reviewStatus === "needs_manual_verification" && !openManual ? "pending" : d.reviewStatus;
      const changed = JSON.stringify(next) !== JSON.stringify(d.flags) || reviewStatus !== d.reviewStatus || JSON.stringify(completeness) !== JSON.stringify(d.completeness);
      if (changed) await tx.update<DocumentRecord>("documents", d.id, { flags: next, completeness, reviewStatus, updatedAt: nowISO() });
    }
  });
  await refreshStudentCases(repo, actor, studentId);
  for (const c of cases) await syncTasks(repo, actor, c.id);
}

export async function resolveFlag(repo: Repo, actor: Actor, documentId: string, flagIdToResolve: string, note: string) {
  assertStudentAccess(actor, "", "doc.review");
  if (note.trim().length < 10) throw new ValidationError("Write what you checked (at least 10 characters).");
  const doc = await repo.get<DocumentRecord>("documents", documentId);
  if (!doc || doc.organizationId !== actor.organizationId) throw new NotFoundError("Document");
  const flag = doc.flags.find((f) => f.id === flagIdToResolve);
  if (!flag) throw new NotFoundError("Flag");
  const resolved = { by: actor.name, at: nowISO(), note: note.trim() };
  await repo.transaction(async (tx) => {
    await tx.update<DocumentRecord>("documents", documentId, { flags: doc.flags.map((f) => (f.id === flagIdToResolve ? { ...f, resolved } : f)), updatedAt: nowISO() });
    await audit(tx, actor, { action: "document.flag_resolved", entity: "documents", entityId: documentId, caseId: doc.caseId, before: { flag: flag.code }, after: { resolved } });
  });
  await recomputeConsistency(repo, actor, doc.studentId);
}

export async function reviewDocument(repo: Repo, actor: Actor, documentId: string, status: "verified" | "rejected", note: string) {
  assertStudentAccess(actor, "", "doc.review");
  const doc = await repo.get<DocumentRecord>("documents", documentId);
  if (!doc || doc.organizationId !== actor.organizationId) throw new NotFoundError("Document");
  if (status === "verified") {
    const open = doc.flags.filter((f) => (f.severity === "critical" || f.needsManualVerification) && !f.resolved);
    if (open.length) throw new ValidationError(`Resolve ${open.length} open flag(s) with a note before marking this document verified.`);
    if (doc.extractionStatus === "pending") throw new ValidationError("Wait for extraction or enter fields manually first.");
  }
  if (status === "rejected" && note.trim().length < 5) throw new ValidationError("Give a reason for rejecting (shown to the student).");
  await repo.transaction(async (tx) => {
    await tx.update<DocumentRecord>("documents", documentId, { reviewStatus: status, reviewedBy: actor.name, reviewedAt: nowISO(), reviewNote: note.trim() || undefined, updatedAt: nowISO() });
    await audit(tx, actor, { action: `document.${status}`, entity: "documents", entityId: documentId, caseId: doc.caseId, before: { reviewStatus: doc.reviewStatus }, after: { reviewStatus: status, note } });
  });
  await recomputeConsistency(repo, actor, doc.studentId);
}
