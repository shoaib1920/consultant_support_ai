import { COUNTRIES } from "@/domain/countries";
import type { Attestation, AttestationAuthority, AttestationStep, Case, CountryCheckState, Programme, Rule, Student } from "@/domain/types";
import { findRule } from "@/domain/rules";
import { type Actor, assertCan } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import type { z } from "zod";
import type { AttestationStepSchema, CaseCreateSchema, CaseUpdateSchema, CountryCheckSchema } from "../schemas";
import { audit } from "./audit";
import { NotFoundError } from "./bundle";
import { bumpDataVersion, recomputeEligibility } from "./eligibility";
import { syncTasks } from "./tasks";

export function expectedDays(rules: Rule[], authority: AttestationAuthority, country: Case["country"]): number {
  const r = findRule(rules, `attestation.days.${authority}`, { country });
  return typeof r?.value === "number" ? r.value : 14;
}

export function buildAttestations(kase: Case, rules: Rule[]): Attestation[] {
  const now = nowISO();
  return COUNTRIES[kase.country].attestation.map((t) => ({
    id: newId("at_"),
    organizationId: kase.organizationId,
    createdAt: now,
    updatedAt: now,
    caseId: kase.id,
    studentId: kase.studentId,
    documentLabel: t.label,
    country: kase.country,
    steps: t.steps.map<AttestationStep>((a) => ({ authority: a, status: "not_started", expectedDays: expectedDays(rules, a, kase.country) })),
  }));
}

export async function createCase(repo: Repo, actor: Actor, input: z.infer<typeof CaseCreateSchema>): Promise<Case> {
  assertCan(actor, "case.write");
  const student = await repo.get<Student>("students", input.studentId);
  if (!student || student.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  const found = input.programmeId ? await repo.get<Programme>("programmes", input.programmeId) : null;
  if (input.programmeId && (!found || found.organizationId !== actor.organizationId)) throw new NotFoundError("Programme");
  const programme = found;
  const rules = await repo.list<Rule>("rules", [["organizationId", "==", actor.organizationId]]);
  const now = nowISO();
  const kase: Case = {
    id: newId("cs_"),
    organizationId: actor.organizationId,
    createdAt: now,
    updatedAt: now,
    studentId: input.studentId,
    studentName: student.personal.fullName,
    country: input.country,
    programmeId: programme?.id,
    universityName: input.universityName,
    programmeName: input.programmeName,
    programmeField: input.programmeField ?? programme?.field,
    level: input.level,
    intake: input.intake,
    intakeStartDate: input.intakeStartDate,
    applicationDeadline: input.applicationDeadline,
    plannedVisaApplicationDate: input.plannedVisaApplicationDate,
    city: input.city,
    inLondon: input.inLondon,
    courseMonths: input.courseMonths,
    tuitionFee: { amount: input.tuitionAmount, currency: input.tuitionCurrency },
    tuitionPaid: input.tuitionPaid,
    minCGPA4: input.minCGPA4 ?? programme?.minCGPA4,
    minGermanGrade: input.minGermanGrade ?? programme?.minGermanGrade,
    englishRequirement: input.ielts || input.pte || input.duolingo || input.moiAccepted ? { ielts: input.ielts, pte: input.pte, duolingo: input.duolingo, moiAccepted: input.moiAccepted } : programme?.english,
    stage: "Lead",
    stageHistory: [{ stage: "Lead", at: now, by: actor.name }],
    assignedOfficerId: input.assignedOfficerId || (actor.role === "officer" ? actor.id : undefined),
    counsellorId: student.counsellorId,
    countryChecks: Object.fromEntries(COUNTRIES[input.country].checks.map((c) => [c.key, { status: "not_started" } as CountryCheckState])),
    dataVersion: 1,
  };
  await repo.transaction(async (tx) => {
    await tx.set("cases", kase.id, kase);
    for (const a of buildAttestations(kase, rules)) await tx.set("attestations", a.id, a);
    await audit(tx, actor, { action: "case.created", entity: "cases", entityId: kase.id, caseId: kase.id, after: { country: kase.country, university: kase.universityName, programme: kase.programmeName, intake: kase.intake } });
  });
  await recomputeEligibility(repo, actor, kase.id);
  await syncTasks(repo, actor, kase.id);
  return kase;
}

export async function updateCase(repo: Repo, actor: Actor, caseId: string, input: z.infer<typeof CaseUpdateSchema>) {
  assertCan(actor, "case.write");
  await repo.transaction(async (tx) => {
    const c = await tx.get<Case>("cases", caseId);
    if (!c || c.organizationId !== actor.organizationId) throw new NotFoundError("Case");
    const patch: Partial<Case> = {
      ...(input.universityName ? { universityName: input.universityName } : {}),
      ...(input.programmeName ? { programmeName: input.programmeName } : {}),
      ...(input.programmeField !== undefined ? { programmeField: input.programmeField } : {}),
      ...(input.intake ? { intake: input.intake } : {}),
      ...(input.intakeStartDate ? { intakeStartDate: input.intakeStartDate } : {}),
      ...(input.applicationDeadline !== undefined ? { applicationDeadline: input.applicationDeadline } : {}),
      ...(input.plannedVisaApplicationDate !== undefined ? { plannedVisaApplicationDate: input.plannedVisaApplicationDate } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.inLondon !== undefined ? { inLondon: input.inLondon } : {}),
      ...(input.courseMonths ? { courseMonths: input.courseMonths } : {}),
      ...(input.tuitionAmount !== undefined && input.tuitionCurrency ? { tuitionFee: { amount: input.tuitionAmount, currency: input.tuitionCurrency } } : {}),
      ...(input.tuitionPaid !== undefined ? { tuitionPaid: input.tuitionPaid } : {}),
      ...(input.minCGPA4 !== undefined ? { minCGPA4: input.minCGPA4 } : {}),
      ...(input.minGermanGrade !== undefined ? { minGermanGrade: input.minGermanGrade } : {}),
      ...(input.ielts !== undefined || input.pte !== undefined || input.moiAccepted !== undefined ? { englishRequirement: { ielts: input.ielts, pte: input.pte, duolingo: input.duolingo, moiAccepted: input.moiAccepted } } : {}),
      ...(input.assignedOfficerId !== undefined ? { assignedOfficerId: input.assignedOfficerId } : {}),
      updatedAt: nowISO(),
    };
    await tx.update<Case>("cases", caseId, patch);
    await bumpDataVersion(tx, [caseId]);
    await audit(tx, actor, { action: "case.updated", entity: "cases", entityId: caseId, caseId, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (c as unknown as Record<string, unknown>)[k]])), after: patch });
  });
  await recomputeEligibility(repo, actor, caseId);
  await syncTasks(repo, actor, caseId);
}

export async function setCountryCheck(repo: Repo, actor: Actor, caseId: string, input: z.infer<typeof CountryCheckSchema>) {
  assertCan(actor, "case.write");
  await repo.transaction(async (tx) => {
    const c = await tx.get<Case>("cases", caseId);
    if (!c || c.organizationId !== actor.organizationId) throw new NotFoundError("Case");
    if (!COUNTRIES[c.country].checks.some((k) => k.key === input.key)) throw new NotFoundError("Country check");
    const before = c.countryChecks[input.key];
    const next: CountryCheckState = { status: input.status, date: input.date, reference: input.reference, note: input.note };
    await tx.update<Case>("cases", caseId, { countryChecks: { ...c.countryChecks, [input.key]: next }, updatedAt: nowISO() });
    await bumpDataVersion(tx, [caseId]);
    await audit(tx, actor, { action: "case.country_check", entity: "cases", entityId: caseId, caseId, before: { [input.key]: before }, after: { [input.key]: next } });
  });
  await recomputeEligibility(repo, actor, caseId);
  await syncTasks(repo, actor, caseId);
}

export async function updateAttestationStep(repo: Repo, actor: Actor, caseId: string, input: z.infer<typeof AttestationStepSchema>) {
  assertCan(actor, "case.write");
  await repo.transaction(async (tx) => {
    const a = await tx.get<Attestation>("attestations", input.attestationId);
    if (!a || a.organizationId !== actor.organizationId || a.caseId !== caseId) throw new NotFoundError("Attestation");
    const steps = a.steps.map((s) => (s.authority === input.authority ? { ...s, status: input.status, submittedAt: input.submittedAt, completedAt: input.completedAt, reference: input.reference } : s));
    await tx.update<Attestation>("attestations", a.id, { steps, updatedAt: nowISO() });
    await bumpDataVersion(tx, [caseId]);
    await audit(tx, actor, { action: "attestation.updated", entity: "attestations", entityId: a.id, caseId, before: a.steps.find((s) => s.authority === input.authority), after: steps.find((s) => s.authority === input.authority) });
  });
  await recomputeEligibility(repo, actor, caseId);
  await syncTasks(repo, actor, caseId);
}

export async function setCasDetails(repo: Repo, actor: Actor, caseId: string, cas: Case["cas"]) {
  assertCan(actor, "case.write");
  await repo.transaction(async (tx) => {
    const c = await tx.get<Case>("cases", caseId);
    if (!c || c.organizationId !== actor.organizationId) throw new NotFoundError("Case");
    await tx.update<Case>("cases", caseId, { cas, updatedAt: nowISO() });
    await bumpDataVersion(tx, [caseId]);
    await audit(tx, actor, { action: "case.cas_details", entity: "cases", entityId: caseId, caseId, before: c.cas, after: cas });
  });
  await recomputeEligibility(repo, actor, caseId);
}
