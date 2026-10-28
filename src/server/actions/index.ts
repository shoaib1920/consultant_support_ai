"use server";

// All server actions. Each one: authenticate -> authorise -> validate (zod) -> service -> revalidate.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { IrreversibleAction, Rule, Stage } from "@/domain/types";
import { STAGES } from "@/domain/types";
import { checkRateLimit } from "../ai";

import { clearSession, demoMode, issueFirebaseSession, issueMockSession, requireActor } from "../auth/session";
import { firebaseConfigured, getRepo } from "../db";
import {
  AttestationStepSchema,
  CaseCreateSchema,
  CaseUpdateSchema,
  CountryCheckSchema,
  DocTypeSchema,
  PaymentSchema,
  ProgrammeSchema,
  RuleCreateSchema,
  RuleUpdateSchema,
  StatementSchema,
  StudentProfileSchema,
  UserCreateSchema,
} from "../schemas";
import { createCase, setCasDetails, setCountryCheck, updateAttestationStep, updateCase } from "../services/cases";
import { resolveFlag, reviewDocument, runExtraction, saveManualFields, uploadDocument } from "../services/documents";
import { recomputeEligibility } from "../services/eligibility";
import { analyzeFromDocument, analyzeManual } from "../services/financial";
import { cancelPreflight, confirmPreflight, grantOverride, signRiskAcknowledgment, startPreflight, transitionCase } from "../services/gates";
import { attachReceipt, recordRefundablePayment, setPaymentStatus } from "../services/payments";
import { runMatching, upsertProgramme } from "../services/programmes";
import { createRule, updateRule, verifyRule } from "../services/rules";
import { createIntakeLink, createPortalAccount, createStudent, deleteStudentData, saveProfile, saveProfileViaToken } from "../services/students";
import { createManualTask, setTaskStatus } from "../services/tasks";
import { seedDemo } from "../seed";
import { audit } from "../services/audit";
import { newId, nowISO } from "../db";
import type { Notification, User } from "@/domain/types";
import { type ActionResult, bool, formObject, run, str } from "./result";

type Prev = ActionResult | null;

// ---------------- auth ----------------

export async function demoLoginAction(_: Prev, fd: FormData): Promise<ActionResult> {
  if (!demoMode()) return { ok: false, error: "Demo login is disabled." };
  const uid = str(fd, "uid");
  const repo = await getRepo();
  const u = await repo.get<User>("users", uid);
  if (!u || !u.active) return { ok: false, error: "Unknown user" };
  await issueMockSession(uid);
  redirect(u.role === "student" ? "/portal" : "/dashboard");
}

export async function firebaseSessionAction(idToken: string): Promise<ActionResult> {
  return run(async () => {
    if (!firebaseConfigured()) return { ok: false, error: "Firebase is not configured." };
    await issueFirebaseSession(idToken);
    return { ok: true };
  });
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

// ---------------- students ----------------

export async function createStudentAction(_: Prev, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const a = await requireActor("student.write");
    const input = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().max(30).optional(), email: z.string().email().optional().or(z.literal("")) }).parse(formObject(fd, ["fullName", "phone", "email"]));
    const s = await createStudent(await getRepo(), a, { fullName: input.fullName, phone: input.phone || undefined, email: input.email || undefined });
    id = s.id;
  });
  if (r.ok) redirect(`/students/${id}`);
  return r;
}

export async function saveProfileAction(studentId: string, json: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("student.write");
    const input = StudentProfileSchema.parse(JSON.parse(json));
    await saveProfile(await getRepo(), a, studentId, input);
    revalidatePath(`/students/${studentId}`);
    return "Profile saved. Eligibility for this student's cases was re-assessed.";
  });
}

export async function saveIntakeAction(token: string, json: string): Promise<ActionResult> {
  return run(async () => {
    checkRateLimit(`intake:${token}`, 20);
    const input = StudentProfileSchema.parse(JSON.parse(json));
    await saveProfileViaToken(await getRepo(), token, { ...input, internalNotes: undefined });
    return "Thank you — your details were submitted securely. Your consultant will contact you.";
  });
}

export async function intakeLinkAction(studentId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("student.write");
    const token = await createIntakeLink(await getRepo(), a, studentId);
    revalidatePath(`/students/${studentId}`);
    return { ok: true, message: "Secure intake link created (valid 7 days).", data: { url: `/intake/${token}` } };
  });
}

export async function portalAccountAction(studentId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("student.write");
    const r = await createPortalAccount(await getRepo(), a, studentId);
    revalidatePath(`/students/${studentId}`);
    return { ok: true, message: r.setupLink ? "Portal account created. Share the password-setup link with the student." : "Portal account created. In demo mode the student can log in from the login page.", data: { setupLink: r.setupLink } };
  });
}

export async function deleteStudentAction(studentId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    const a = await requireActor("student.delete");
    await deleteStudentData(await getRepo(), a, studentId, str(fd, "confirmName"));
  });
  if (r.ok) redirect("/students");
  return r;
}

export async function runMatchingAction(studentId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("analysis.run");
    await runMatching(await getRepo(), a, studentId);
    revalidatePath(`/students/${studentId}/matching`);
    return "Matching updated.";
  });
}

// ---------------- cases ----------------

const CASE_KEYS = ["studentId", "programmeId", "country", "universityName", "programmeName", "programmeField", "level", "intake", "intakeStartDate", "applicationDeadline", "plannedVisaApplicationDate", "city", "inLondon", "courseMonths", "tuitionAmount", "tuitionCurrency", "tuitionPaid", "minCGPA4", "minGermanGrade", "ielts", "pte", "duolingo", "moiAccepted", "assignedOfficerId"];

export async function createCaseAction(_: Prev, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const a = await requireActor("case.write");
    const raw = formObject(fd, CASE_KEYS);
    if (!raw.programmeId) delete raw.programmeId;
    const input = CaseCreateSchema.parse(raw);
    id = (await createCase(await getRepo(), a, input)).id;
  });
  if (r.ok) redirect(`/cases/${id}`);
  return r;
}

export async function createCaseFromProgrammeAction(studentId: string, programmeId: string): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const a = await requireActor("case.write");
    const repo = await getRepo();
    const p = await repo.get<import("@/domain/types").Programme>("programmes", programmeId);
    if (!p || p.organizationId !== a.organizationId) return { ok: false, error: "Programme not found" };
    const today = nowISO().slice(0, 10);
    const intake = p.intakes.filter((i) => i.applicationDeadline >= today).sort((x, y) => x.applicationDeadline.localeCompare(y.applicationDeadline))[0] ?? p.intakes[0];
    const c = await createCase(repo, a, {
      studentId,
      programmeId,
      country: p.country,
      universityName: p.universityName,
      programmeName: p.name,
      programmeField: p.field,
      level: p.level,
      intake: intake.label,
      intakeStartDate: intake.startDate,
      applicationDeadline: intake.applicationDeadline,
      plannedVisaApplicationDate: undefined,
      city: p.city,
      inLondon: !!p.inLondon,
      courseMonths: p.durationMonths,
      tuitionAmount: Math.round(p.tuitionPerYear * Math.max(1, p.durationMonths / 12)),
      tuitionCurrency: p.currency,
      tuitionPaid: 0,
      minCGPA4: p.minCGPA4,
      minGermanGrade: p.minGermanGrade,
      ielts: p.english.ielts,
      pte: p.english.pte,
      duolingo: p.english.duolingo,
      moiAccepted: !!p.english.moiAccepted,
      assignedOfficerId: undefined,
    });
    id = c.id;
  });
  if (r.ok) redirect(`/cases/${id}`);
  return r;
}

export async function updateCaseAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.write");
    const input = CaseUpdateSchema.parse(formObject(fd, CASE_KEYS.filter((k) => !["studentId", "programmeId", "country"].includes(k))));
    await updateCase(await getRepo(), a, caseId, input);
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Case updated and re-assessed.";
  });
}

export async function countryCheckAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.write");
    await setCountryCheck(await getRepo(), a, caseId, CountryCheckSchema.parse(formObject(fd, ["key", "status", "date", "reference", "note"])));
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Saved.";
  });
}

export async function attestationAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.write");
    await updateAttestationStep(await getRepo(), a, caseId, AttestationStepSchema.parse(formObject(fd, ["attestationId", "authority", "status", "submittedAt", "completedAt", "reference"])));
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Attestation step updated.";
  });
}

export async function casAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.write");
    const cas = z.object({ name: z.string().max(120).optional(), course: z.string().max(200).optional(), tuitionFee: z.coerce.number().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).parse(formObject(fd, ["name", "course", "tuitionFee", "startDate", "endDate"]));
    await setCasDetails(await getRepo(), a, caseId, cas);
    revalidatePath(`/cases/${caseId}`, "layout");
    return "CAS details saved.";
  });
}

export async function recomputeAction(caseId: string, withAI: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("analysis.run");
    await recomputeEligibility(await getRepo(), a, caseId, { withAI });
    revalidatePath(`/cases/${caseId}`, "layout");
    return withAI ? "Assessment refreshed with AI explanation." : "Assessment refreshed.";
  });
}

export async function transitionAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.transition");
    const to = z.enum(STAGES).parse(str(fd, "to")) as Stage;
    const offer = str(fd, "offerType") ? { type: z.enum(["conditional", "unconditional"]).parse(str(fd, "offerType")), receivedAt: str(fd, "offerDate") || nowISO().slice(0, 10), reference: str(fd, "offerRef") || undefined } : undefined;
    const decision = str(fd, "outcome") ? { outcome: z.enum(["approved", "refused", "withdrawn"]).parse(str(fd, "outcome")), at: str(fd, "decisionDate") || nowISO().slice(0, 10), reason: str(fd, "decisionReason") || undefined } : undefined;
    await transitionCase(await getRepo(), a, caseId, to, { offer, decision });
    revalidatePath(`/cases/${caseId}`, "layout");
    return `Moved to "${to}".`;
  });
}

// ---------------- gates ----------------

export async function startPreflightAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("preflight.request");
    const action = z.enum(["pay_fee", "submit_application", "file_visa"]).parse(str(fd, "action")) as IrreversibleAction;
    const payment = str(fd, "amount") ? PaymentSchema.parse({ ...formObject(fd, ["type", "amount", "currency", "payee"]), refundable: str(fd, "refundable") === "yes" }) : undefined;
    await startPreflight(await getRepo(), a, caseId, action, payment, { reviewedWarnings: bool(fd, "reviewedWarnings"), checkedAmount: bool(fd, "checkedAmount") });
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Officer confirmation recorded. A Manager must now confirm.";
  });
}

export async function confirmPreflightAction(caseId: string, approvalId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("preflight.confirm_manager");
    await confirmPreflight(await getRepo(), a, approvalId, { understandsNonRefundable: bool(fd, "understandsNonRefundable") });
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Confirmed and executed.";
  });
}

export async function cancelPreflightAction(caseId: string, approvalId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("preflight.request");
    await cancelPreflight(await getRepo(), a, approvalId, str(fd, "reason") || "Cancelled");
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Pre-flight cancelled.";
  });
}

export async function overrideAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("override.grant");
    await grantOverride(await getRepo(), a, caseId, str(fd, "reason"));
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Override recorded. The student must now sign the risk acknowledgment in their portal.";
  });
}

export async function signAckAction(ackId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("portal.self");
    await signRiskAcknowledgment(await getRepo(), a, ackId, { signedName: str(fd, "signedName"), signatureDataUrl: str(fd, "signature"), agree: bool(fd, "agree"), userAgent: str(fd, "ua") });
    revalidatePath("/portal");
    return "Thank you. Your signed acknowledgment has been recorded.";
  });
}

// ---------------- documents ----------------

export async function uploadAction(_: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };
    const studentId = a.role === "student" ? a.studentId! : str(fd, "studentId");
    const docType = DocTypeSchema.parse(str(fd, "docType"));
    const mime = file.type || (file.name.endsWith(".json") ? "application/json" : "application/octet-stream");
    await uploadDocument(await getRepo(), a, { studentId, caseId: str(fd, "caseId") || undefined, docType, fileName: file.name, mimeType: mime, bytes: Buffer.from(await file.arrayBuffer()) });
    revalidatePath("/", "layout");
    return a.role === "student" ? "Uploaded. Our team will review it." : "Uploaded and processed. Review the extracted fields and flags.";
  });
}

export async function reviewDocAction(documentId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("doc.review");
    await reviewDocument(await getRepo(), a, documentId, z.enum(["verified", "rejected"]).parse(str(fd, "status")), str(fd, "note"));
    revalidatePath("/", "layout");
    return "Review saved.";
  });
}

export async function resolveFlagAction(documentId: string, flagId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("doc.review");
    await resolveFlag(await getRepo(), a, documentId, flagId, str(fd, "note"));
    revalidatePath("/", "layout");
    return "Flag resolved with your note.";
  });
}

export async function manualFieldsAction(documentId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("doc.review");
    const fields: Record<string, string | number | null> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("f_") || typeof v !== "string") continue;
      const key = k.slice(2);
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key)) continue;
      fields[key] = v === "" ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.slice(0, 500);
    }
    const nk = str(fd, "newKey");
    if (nk && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(nk)) fields[nk] = str(fd, "newValue").slice(0, 500);
    await saveManualFields(await getRepo(), a, documentId, fields);
    revalidatePath("/", "layout");
    return "Fields saved (source: manual). Consistency re-checked.";
  });
}

export async function reextractAction(documentId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("doc.review");
    await runExtraction(await getRepo(), a, documentId);
    revalidatePath("/", "layout");
    return "Extraction re-run.";
  });
}

// ---------------- financial ----------------

export async function analyzeDocAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("analysis.run");
    const exps = z.array(z.object({ date: z.string(), amount: z.coerce.number(), note: z.string().min(3) })).parse(JSON.parse(str(fd, "explanations") || "[]"));
    await analyzeFromDocument(await getRepo(), a, caseId, str(fd, "documentId"), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(str(fd, "applicationDate")), exps);
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Statement analysed.";
  });
}

export async function analyzeManualAction(caseId: string, json: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("analysis.run");
    const s = StatementSchema.parse(JSON.parse(json));
    await analyzeManual(await getRepo(), a, caseId, s, s.applicationDate, s.explanations);
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Statement analysed (manual entry).";
  });
}

// ---------------- payments ----------------

export async function recordPaymentAction(caseId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("payment.record");
    const p = PaymentSchema.parse({ ...formObject(fd, ["type", "amount", "currency", "payee"]), refundable: str(fd, "refundable") === "yes" });
    await recordRefundablePayment(await getRepo(), a, caseId, p);
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Refundable payment recorded.";
  });
}

export async function paymentStatusAction(caseId: string, paymentId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("payment.record");
    await setPaymentStatus(await getRepo(), a, paymentId, z.enum(["authorized", "paid", "refunded", "void"]).parse(str(fd, "status")));
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Payment updated.";
  });
}

export async function receiptAction(caseId: string, paymentId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("payment.record");
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) return { ok: false, error: "Choose a receipt file." };
    await attachReceipt(await getRepo(), a, paymentId, { name: f.name, mimeType: f.type, bytes: Buffer.from(await f.arrayBuffer()) });
    revalidatePath(`/cases/${caseId}`, "layout");
    return "Receipt attached.";
  });
}

// ---------------- rules ----------------

export async function updateRuleAction(ruleId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("rules.edit");
    const repo = await getRepo();
    const cur = await repo.get<Rule>("rules", ruleId);
    const rawVal = str(fd, "value");
    const value = typeof cur?.value === "number" ? Number(rawVal) : typeof cur?.value === "boolean" ? rawVal === "true" : rawVal;
    const input = RuleUpdateSchema.parse({ ...formObject(fd, ["unit", "label", "sourceUrl", "sourceNote", "status", "notes", "reason"]), value });
    await updateRule(repo, a, ruleId, input);
    revalidatePath("/rules", "layout");
    return a.role === "officer" || a.role === "counsellor" ? "Saved as Unverified — a manager must verify." : "Rule saved. Affected cases re-assessed.";
  });
}

export async function verifyRuleAction(ruleId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("rules.verify");
    await verifyRule(await getRepo(), a, ruleId);
    revalidatePath("/", "layout");
    return "Marked verified. Affected cases re-assessed.";
  });
}

export async function createRuleAction(_: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("rules.edit");
    const t = str(fd, "valueType");
    const raw = str(fd, "value");
    const value = t === "number" ? Number(raw) : t === "boolean" ? raw === "true" : raw;
    await createRule(await getRepo(), a, RuleCreateSchema.parse({ ...formObject(fd, ["country", "level", "intake", "key", "label", "unit", "sourceUrl", "notes"]), value }));
    revalidatePath("/rules", "layout");
    return "Rule created as Unverified.";
  });
}

// ---------------- programmes ----------------

const PROG_KEYS = ["universityName", "country", "city", "inLondon", "name", "level", "field", "keywords", "minCGPA4", "minGermanGrade", "ielts", "pte", "duolingo", "moiAccepted", "germanLevel", "tuitionPerYear", "currency", "durationMonths", "intakeLabel", "intakeStart", "intakeDeadline", "complianceNotes", "active"];
export async function upsertProgrammeAction(programmeId: string | null, _: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("programmes.edit");
    await upsertProgramme(await getRepo(), a, programmeId, ProgrammeSchema.parse(formObject(fd, PROG_KEYS)));
    revalidatePath("/programmes");
    return "Programme saved.";
  });
}

// ---------------- tasks / notifications ----------------

export async function taskStatusAction(taskId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.read");
    await setTaskStatus(await getRepo(), a, taskId, done);
    revalidatePath("/", "layout");
  });
}

export async function createTaskAction(_: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("case.write");
    const t = z.object({ title: z.string().min(3).max(200), detail: z.string().max(1000).optional(), dueDate: z.string().optional(), caseId: z.string().optional() }).parse(formObject(fd, ["title", "detail", "dueDate", "caseId"]));
    await createManualTask(await getRepo(), a, { ...t, caseId: t.caseId || undefined, dueDate: t.dueDate || undefined });
    revalidatePath("/", "layout");
    return "Task added.";
  });
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor();
    const repo = await getRepo();
    const ns = await repo.list<Notification>("notifications", [["organizationId", "==", a.organizationId], ["userId", "==", a.id], ["read", "==", false]]);
    for (const n of ns) await repo.update<Notification>("notifications", n.id, { read: true });
    revalidatePath("/", "layout");
  });
}

// ---------------- admin ----------------

export async function resetDemoAction(): Promise<ActionResult> {
  const r = await run(async () => {
    const a = await requireActor("demo.reset");
    if (!demoMode()) return { ok: false, error: "Demo mode is off." };
    if (a.organizationId !== "org_demo") return { ok: false, error: "Only the demo organisation can be reset." };
    await seedDemo(await getRepo());
  });
  if (r.ok) {
    revalidatePath("/", "layout");
    redirect("/dashboard?reset=1");
  }
  return r;
}

export async function createUserAction(_: Prev, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("users.manage");
    const input = UserCreateSchema.parse(formObject(fd, ["name", "email", "role"]));
    const repo = await getRepo();
    const now = nowISO();
    let id = newId("us_");
    if (firebaseConfigured()) {
      const { getAuth } = await import("firebase-admin/auth");
      const { getAdminApp } = await import("../firebase-admin");
      const u = await getAuth(getAdminApp()).createUser({ email: input.email, displayName: input.name });
      id = u.uid;
      await getAuth(getAdminApp()).setCustomUserClaims(id, { orgId: a.organizationId, role: input.role });
    }
    await repo.transaction(async (tx) => {
      await tx.set<User>("users", id, { id, organizationId: a.organizationId, createdAt: now, updatedAt: now, ...input, active: true });
      await audit(tx, a, { action: "user.created", entity: "users", entityId: id, after: input });
    });
    revalidatePath("/settings");
    return "User created.";
  });
}

export async function toggleUserAction(userId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await requireActor("users.manage");
    if (userId === a.id) return { ok: false, error: "You cannot deactivate yourself." };
    const repo = await getRepo();
    await repo.transaction(async (tx) => {
      const u = await tx.get<User>("users", userId);
      if (!u || u.organizationId !== a.organizationId) throw new Error("not found");
      await tx.update<User>("users", userId, { active: !u.active, updatedAt: nowISO() });
      await audit(tx, a, { action: u.active ? "user.deactivated" : "user.activated", entity: "users", entityId: userId });
    });
    revalidatePath("/settings");
  });
}
