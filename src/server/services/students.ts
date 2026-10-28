import type { Case, Student, User } from "@/domain/types";
import { AuthError } from "../auth/rbac";
import { type Actor, assertCan } from "../auth/session";
import { randomToken } from "../crypto";
import { firebaseConfigured, type CollectionName, type Repo, newId, nowISO } from "../db";
import type { StudentProfileInput } from "../schemas";
import { deleteFile } from "../storage";
import { type AuditActor, audit } from "./audit";
import { NotFoundError } from "./bundle";
import { refreshStudentCases } from "./eligibility";

export const CONSENT_VERSION = "2026-10-v1";
export const CONSENT_TEXT =
  "I consent to the consultancy storing and processing my personal data and documents to assess and manage my study-visa applications, including automated checks (AI-assisted). Decisions are made by staff, not by software. I can request a copy or deletion of my data at any time.";

export function emptyStudent(organizationId: string, fullName: string, extra: Partial<Student> = {}): Student {
  const now = nowISO();
  return {
    id: newId("st_"),
    organizationId,
    createdAt: now,
    updatedAt: now,
    personal: { fullName, nationality: "Pakistani" },
    education: [],
    gaps: [],
    englishTests: [],
    work: [],
    sponsors: [],
    budget: {},
    intended: { countries: [] },
    refusals: [],
    travel: [],
    consent: { given: false },
    ...extra,
  };
}

export async function createStudent(repo: Repo, actor: Actor, input: { fullName: string; phone?: string; email?: string }) {
  assertCan(actor, "student.write");
  const s = emptyStudent(actor.organizationId, input.fullName.trim(), { counsellorId: actor.role === "counsellor" ? actor.id : undefined });
  s.personal.phone = input.phone;
  s.personal.email = input.email;
  await repo.transaction(async (tx) => {
    await tx.set("students", s.id, s);
    await audit(tx, actor, { action: "student.created", entity: "students", entityId: s.id, after: { fullName: s.personal.fullName } });
  });
  return s;
}

function applyProfile(cur: Student, input: StudentProfileInput, by: string, staff: boolean): Student {
  const consent = input.consentGiven ? (cur.consent.given ? cur.consent : { given: true, at: nowISO(), by, version: CONSENT_VERSION }) : { given: false };
  return {
    ...cur,
    personal: input.personal,
    education: input.education.map((e) => ({ ...e, completed: e.completed ?? true })),
    gaps: input.gaps,
    englishTests: input.englishTests,
    work: input.work,
    sponsors: input.sponsors,
    budget: input.budget,
    intended: { ...input.intended, intake: input.intended.intake || undefined },
    refusals: input.refusals,
    travel: input.travel,
    tiesToPakistan: input.tiesToPakistan,
    consent,
    internalNotes: staff ? input.internalNotes : cur.internalNotes,
    updatedAt: nowISO(),
  };
}

export async function saveProfile(repo: Repo, actor: Actor, studentId: string, input: StudentProfileInput) {
  assertCan(actor, "student.write");
  await repo.transaction(async (tx) => {
    const cur = await tx.get<Student>("students", studentId);
    if (!cur || cur.organizationId !== actor.organizationId) throw new NotFoundError("Student");
    const next = applyProfile(cur, input, actor.name, true);
    await tx.set("students", studentId, next);
    await audit(tx, actor, { action: "student.profile_saved", entity: "students", entityId: studentId, before: { consent: cur.consent.given, education: cur.education.length }, after: { consent: next.consent.given, education: next.education.length, completenessInputs: true } });
  });
  await syncCaseNames(repo, actor.organizationId, studentId, input.personal.fullName);
  await refreshStudentCases(repo, actor, studentId);
}

async function syncCaseNames(repo: Repo, organizationId: string, studentId: string, name: string) {
  const cases = await repo.list<Case>("cases", [["organizationId", "==", organizationId], ["studentId", "==", studentId]]);
  for (const c of cases) if (c.studentName !== name) await repo.update<Case>("cases", c.id, { studentName: name });
}

export async function createIntakeLink(repo: Repo, actor: Actor, studentId: string): Promise<string> {
  assertCan(actor, "student.write");
  const token = randomToken(24);
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await repo.transaction(async (tx) => {
    const s = await tx.get<Student>("students", studentId);
    if (!s || s.organizationId !== actor.organizationId) throw new NotFoundError("Student");
    await tx.update<Student>("students", studentId, { intakeToken: token, intakeTokenExpiresAt: expires });
    await audit(tx, actor, { action: "student.intake_link_created", entity: "students", entityId: studentId, after: { expires } });
  });
  return token;
}

export async function studentByIntakeToken(repo: Repo, token: string): Promise<Student | null> {
  if (!token || token.length < 20) return null;
  const rows = await repo.list<Student>("students", [["intakeToken", "==", token]]);
  const s = rows[0];
  if (!s || !s.intakeTokenExpiresAt || s.intakeTokenExpiresAt < nowISO()) return null;
  return s;
}

export async function saveProfileViaToken(repo: Repo, token: string, input: StudentProfileInput) {
  const s = await studentByIntakeToken(repo, token);
  if (!s) throw new AuthError("This intake link is invalid or has expired.", 401);
  if (!input.consentGiven) throw new AuthError("Consent is required to submit your details.", 403);
  const sys: AuditActor = { id: "system", name: "System", role: "system", organizationId: s.organizationId };
  await repo.transaction(async (tx) => {
    const next = applyProfile(s, input, `${input.personal.fullName} (via secure link)`, false);
    await tx.set("students", s.id, next);
    await audit(tx, sys, { action: "student.profile_saved_via_link", entity: "students", entityId: s.id, after: { consent: true } });
  });
  await refreshStudentCases(repo, sys, s.id);
}

export async function createPortalAccount(repo: Repo, actor: Actor, studentId: string): Promise<{ userId: string; setupLink?: string }> {
  assertCan(actor, "student.write");
  const s = await repo.get<Student>("students", studentId);
  if (!s || s.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  if (s.portalUserId) return { userId: s.portalUserId };
  if (!s.personal.email) throw new AuthError("Add the student's email first.", 403);
  let uid = newId("us_");
  let setupLink: string | undefined;
  if (firebaseConfigured()) {
    const { getAuth } = await import("firebase-admin/auth");
    const { getAdminApp } = await import("../firebase-admin");
    const auth = getAuth(getAdminApp());
    const u = await auth.createUser({ email: s.personal.email, displayName: s.personal.fullName });
    uid = u.uid;
    await auth.setCustomUserClaims(uid, { orgId: s.organizationId, role: "student", studentId });
    setupLink = await auth.generatePasswordResetLink(s.personal.email);
  }
  const now = nowISO();
  await repo.transaction(async (tx) => {
    await tx.set<User>("users", uid, { id: uid, organizationId: s.organizationId, createdAt: now, updatedAt: now, email: s.personal.email!, name: s.personal.fullName, role: "student", active: true, studentId });
    await tx.update<Student>("students", studentId, { portalUserId: uid });
    await audit(tx, actor, { action: "student.portal_account_created", entity: "users", entityId: uid, after: { studentId } });
  });
  return { userId: uid, setupLink };
}

const STUDENT_COLLECTIONS: CollectionName[] = ["documents", "extractedFields", "attestations", "eligibilityResults", "financialAnalyses", "matchResults", "approvals", "riskAcknowledgments", "payments", "tasks", "gateEvents"];

export async function exportStudentData(repo: Repo, actor: Actor, studentId: string) {
  assertCan(actor, "student.read");
  const s = await repo.get<Student>("students", studentId);
  if (!s || s.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const cases = await repo.list<Case>("cases", [org, ["studentId", "==", studentId]]);
  const out: Record<string, unknown> = { exportedAt: nowISO(), student: s, cases };
  for (const c of STUDENT_COLLECTIONS) {
    const byStudent = await repo.list<{ studentId?: string; caseId?: string }>(c, [org]);
    out[c] = byStudent.filter((r) => r.studentId === studentId || cases.some((k) => k.id === r.caseId));
  }
  await repo.transaction((tx) => audit(tx, actor, { action: "student.data_exported", entity: "students", entityId: studentId }));
  return out;
}

export async function deleteStudentData(repo: Repo, actor: Actor, studentId: string, confirmName: string) {
  assertCan(actor, "student.delete");
  const s = await repo.get<Student>("students", studentId);
  if (!s || s.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  if (confirmName.trim() !== s.personal.fullName) throw new AuthError("Type the student's full name exactly to confirm deletion.");
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const cases = await repo.list<Case>("cases", [org, ["studentId", "==", studentId]]);
  const docs = await repo.list<{ id: string; storagePath: string; studentId: string }>("documents", [org, ["studentId", "==", studentId]]);
  for (const d of docs) await deleteFile(d.storagePath);
  await repo.transaction(async (tx) => {
    for (const c of STUDENT_COLLECTIONS) {
      const rows = await tx.list<{ id: string; studentId?: string; caseId?: string }>(c, [org]);
      for (const r of rows.filter((r) => r.studentId === studentId || cases.some((k) => k.id === r.caseId))) await tx.delete(c, r.id);
    }
    for (const c of cases) await tx.delete("cases", c.id);
    if (s.portalUserId) await tx.delete("users", s.portalUserId);
    await tx.delete("students", studentId);
    // Audit records the deletion without personal data. Earlier audit entries are retained (immutable).
    await audit(tx, actor, { action: "student.deleted", entity: "students", entityId: studentId, after: { cases: cases.length, documents: docs.length } });
  });
}
