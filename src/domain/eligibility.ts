// Deterministic eligibility + risk engine. Produces score, traffic light and itemised reasons,
// each citing a rule, document, field or missing item. AI narrative is layered on top later and
// can never change the light.

import { chainFinishesBefore } from "./attestation";
import { ACTION_LABELS, COUNTRIES, DOC_LABELS, isDueNow, nextIrreversibleAction, requiredDocsFor } from "./countries";
import { addDays, daysBetween, formatDate, isBefore, todayISO } from "./dates";
import { computeFundsRequirement, convert, formatMoney } from "./funds";
import { normalise, qualifyingRecord } from "./grades";
import { RuleContext } from "./rules";
import type {
  Attestation,
  Case,
  DocumentRecord,
  EligibilityResult,
  EnglishTest,
  FinancialAnalysis,
  Light,
  Programme,
  Reason,
  ReasonCategory,
  ReasonRef,
  Rule,
  Severity,
  Student,
} from "./types";

export const ENGINE_VERSION = "1.2.0";

export interface EligibilityInput {
  student: Student;
  kase: Case;
  rules: Rule[];
  programme?: Programme;
  documents: DocumentRecord[];
  attestations: Attestation[];
  financial?: FinancialAnalysis;
  today?: string;
}

export type EligibilityComputation = Omit<EligibilityResult, "id" | "organizationId" | "createdAt" | "updatedAt" | "ai">;

/** Deterministic content hash (FNV-1a) of what a human signs off on. */
export function fingerprintOf(light: Light, reasons: Reason[], ruleIssues: { key: string; problem: string }[]): string {
  const material = [light, ...reasons.filter((r) => r.severity !== "info").map((r) => `${r.category}|${r.severity}|${r.hardFail}|${r.title}`).sort(), ...ruleIssues.map((i) => `${i.key}|${i.problem}`).sort()].join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + ":" + material.length.toString(36);
}

class Reasons {
  list: Reason[] = [];
  add(category: ReasonCategory, code: string, r: Omit<Reason, "id" | "category" | "hardFail" | "confidence"> & { hardFail?: boolean; confidence?: Reason["confidence"] }) {
    this.list.push({ id: `${category}-${code}-${this.list.length}`, category, hardFail: false, confidence: "high", ...r });
  }
}

const SEVERITY_WEIGHT: Record<Severity, number> = { info: 0, warning: 5, critical: 12 };

function ruleRef(r?: Rule): ReasonRef[] {
  return r ? [{ type: "rule", id: r.id, label: `${r.country}:${r.key}` }] : [];
}

function tokens(s?: string): Set<string> {
  const stop = new Set(["of", "and", "in", "the", "with", "msc", "ma", "bs", "bsc", "ba", "master", "masters", "bachelor", "science", "arts", "studies", "hons", "programme", "program", "mba"]);
  return new Set((s ?? "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2 && !stop.has(t)));
}

const RELATED_FIELDS: string[][] = [
  ["computer", "computing", "software", "data", "information", "artificial", "intelligence", "cyber", "security", "technology", "analytics"],
  ["business", "management", "finance", "accounting", "marketing", "economics", "commerce", "administration", "mba"],
  ["engineering", "mechanical", "electrical", "civil", "industrial", "mechatronics", "automation"],
  ["health", "public", "nursing", "pharmacy", "biomedical", "medicine", "biology", "biotechnology"],
];

export function fieldsAligned(a?: string, b?: string): boolean | undefined {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return undefined;
  for (const t of ta) if (tb.has(t)) return true;
  return RELATED_FIELDS.some((group) => [...ta].some((t) => group.includes(t)) && [...tb].some((t) => group.includes(t)));
}

function bestEnglish(tests: EnglishTest[], today: string): { valid: EnglishTest[]; expired: EnglishTest[] } {
  const isExpired = (t: EnglishTest) => (t.expiryDate ? isBefore(t.expiryDate, today) : t.testDate ? daysBetween(t.testDate, today) > 730 : false);
  return { valid: tests.filter((t) => t.type === "MOI" || !isExpired(t)), expired: tests.filter((t) => t.type !== "MOI" && isExpired(t)) };
}

export function computeEligibility(input: EligibilityInput): EligibilityComputation {
  const today = input.today ?? todayISO();
  const { student, kase, programme, documents, attestations, financial } = input;
  const ctx = new RuleContext(input.rules, { country: kase.country, level: kase.level, intake: kase.intake }, today);
  const R = new Reasons();
  const horizon = nextIrreversibleAction(kase.stage);
  const horizonLabel = horizon ? ACTION_LABELS[horizon].toLowerCase() : "next step";
  const country = COUNTRIES[kase.country];

  // ---------------- Academic ----------------
  const rec = qualifyingRecord(student.education, kase.level);
  if (!rec) {
    R.add("Academic", "NO_QUALIFYING", {
      severity: "critical",
      insufficientData: true,
      title: "Insufficient data: qualifying result missing",
      detail: `No ${kase.level === "master" ? "bachelor" : "intermediate/A-Level"} result is recorded, so academic eligibility cannot be assessed.`,
      fix: "Record the qualifying result with its grading scale.",
      askStudent: "Please share your final transcript/marksheet.",
      refs: [{ type: "missing", label: "Qualifying education record" }],
    });
  } else {
    const g = normalise(rec);
    const min = kase.minCGPA4 ?? programme?.minCGPA4;
    const minDe = kase.minGermanGrade ?? programme?.minGermanGrade;
    const recRef: ReasonRef = { type: "field", id: rec.id, label: `${rec.level} – ${rec.institution}` };
    const progRef: ReasonRef = { type: "programme", id: kase.programmeId, label: `${kase.universityName} – ${kase.programmeName}` };
    if (g.cgpa4 == null) {
      R.add("Academic", "GRADE_UNKNOWN", { severity: "critical", insufficientData: true, title: "Insufficient data: grade cannot be converted", detail: g.note, refs: [recRef], confidence: "low", fix: "Enter marks/CGPA and the scale used." });
    } else if (kase.country === "DE" && minDe != null && g.germanGrade != null) {
      if (g.germanGrade > minDe) {
        R.add("Academic", "BELOW_MIN_DE", {
          severity: "critical",
          hardFail: true,
          title: `German grade ${g.germanGrade} is weaker than the programme minimum ${minDe}`,
          detail: `${g.note}. Modified Bavarian formula gives ${g.germanGrade} (1.0 best). Programme requires ${minDe} or better.`,
          fix: "Do not apply/pay for this programme. Choose programmes whose minimum matches, or confirm a written exception from the university.",
          refs: [recRef, progRef],
          confidence: g.confidence,
        });
      } else R.add("Academic", "MEETS_MIN_DE", { severity: "info", title: `Grade ${g.germanGrade} meets the minimum ${minDe}`, detail: g.note, refs: [recRef, progRef], confidence: g.confidence });
    } else if (min == null) {
      R.add("Academic", "NO_MIN", { severity: "warning", insufficientData: true, title: "Insufficient data: programme minimum CGPA not recorded", detail: "Cannot confirm the academic requirement for this programme.", fix: "Add the programme minimum to the programme database from the university website.", refs: [progRef], confidence: "low" });
    } else if (g.cgpa4 < min) {
      R.add("Academic", "BELOW_MIN", {
        severity: "critical",
        hardFail: true,
        title: `CGPA ${g.cgpa4.toFixed(2)} is below the programme minimum ${min.toFixed(2)}`,
        detail: `${g.note}. ${kase.universityName} requires ${min.toFixed(2)}/4.00 for ${kase.programmeName}. Paying the application fee now risks losing it.`,
        fix: "Do not pay or submit. Match to programmes with a lower minimum, a pre-master/pathway, or obtain a written exception from the university first.",
        askStudent: "Do you have a final/improved transcript or any re-sit results not yet recorded?",
        refs: [recRef, progRef],
        confidence: g.confidence,
      });
    } else if (g.cgpa4 - min < 0.1) {
      R.add("Academic", "BORDERLINE", { severity: "warning", title: `Borderline: CGPA ${g.cgpa4.toFixed(2)} vs minimum ${min.toFixed(2)}`, detail: `${g.note}. Universities may apply their own conversion.`, fix: "Confirm with the admissions team in writing before paying.", refs: [recRef, progRef], confidence: g.confidence });
    } else {
      R.add("Academic", "MEETS_MIN", { severity: "info", title: `CGPA ${g.cgpa4.toFixed(2)} meets the minimum ${min.toFixed(2)}`, detail: g.note, refs: [recRef, progRef], confidence: g.confidence });
    }
    if ((rec.backlogs ?? 0) > 0) {
      R.add("Academic", "BACKLOGS", { severity: "warning", title: `${rec.backlogs} backlog(s)/repeat papers`, detail: "Some universities cap the number of backlogs.", fix: "Check the programme's backlog policy.", refs: [recRef] });
    }
    const aligned = fieldsAligned(rec.field ?? rec.program, kase.programmeField ?? kase.programmeName);
    if (aligned === false) {
      R.add("Academic", "FIELD_CHANGE", {
        severity: "warning",
        title: "Course change from previous study",
        detail: `Previous study "${rec.program ?? rec.field}" vs intended "${kase.programmeName}". Officers often question unexplained switches.`,
        fix: "SOP must explain the switch with evidence (work, projects, modules).",
        askStudent: "Why are you changing field, and what have you done to prepare?",
        refs: [recRef, progRef],
        confidence: "medium",
      });
    }
  }

  // Study gaps
  const lastEnd = student.education.map((e) => e.endDate).filter(Boolean).sort().pop();
  if (lastEnd) {
    const gapMonths = Math.floor(daysBetween(lastEnd, kase.intakeStartDate) / 30.4);
    const explained = student.gaps.filter((g) => g.reason.trim().length >= 10);
    const workMonths = student.work.reduce((a, w) => a + Math.max(0, daysBetween(w.from, w.to ?? today) / 30.4), 0);
    if (gapMonths > 24 && explained.length === 0 && workMonths < gapMonths - 12) {
      R.add("Credibility", "GAP_UNEXPLAINED", {
        severity: "warning",
        title: `Study gap of ~${gapMonths} months is not explained`,
        detail: `Last education ended ${formatDate(lastEnd)}. Gaps without evidence are a frequent credibility concern.`,
        fix: "Record the gap reason with evidence (employment letters, medical, family).",
        askStudent: "What did you do between your last studies and now? Do you have evidence?",
        refs: [{ type: "field", label: "Study gaps" }],
      });
    } else if (gapMonths > 24) {
      R.add("Credibility", "GAP_EXPLAINED", { severity: "info", title: `Study gap ~${gapMonths} months (explained/employment)`, detail: "Keep evidence ready for the interview.", refs: [{ type: "field", label: "Study gaps" }] });
    }
  }
  for (const g of student.gaps.filter((g) => g.reason.trim().length < 10)) {
    R.add("Credibility", "GAP_REASON_THIN", { severity: "warning", title: `Gap ${formatDate(g.from)}–${formatDate(g.to)} lacks a clear reason`, detail: "A short or empty reason is not enough.", askStudent: "Please explain this gap and share evidence.", refs: [{ type: "field", id: g.id, label: "Study gap" }] });
  }

  // ---------------- Language ----------------
  const req = kase.englishRequirement ?? programme?.english;
  const { valid, expired } = bestEnglish(student.englishTests, today);
  for (const t of expired) {
    R.add("Language", "EXPIRED_TEST", { severity: "warning", title: `${t.type} result has expired`, detail: `Test dated ${formatDate(t.testDate)} is older than 2 years.`, fix: "Retake the test.", refs: [{ type: "field", id: t.id, label: `${t.type} result` }] });
  }
  if (!req || (req.ielts == null && req.pte == null && req.duolingo == null && !req.moiAccepted)) {
    R.add("Language", "NO_REQ", { severity: "warning", insufficientData: true, title: "Insufficient data: English requirement not recorded", detail: "Programme English requirement unknown.", fix: "Add the requirement in the programme database.", refs: [{ type: "programme", id: kase.programmeId, label: kase.programmeName }], confidence: "low" });
  } else if (valid.length === 0) {
    R.add("Language", "NO_TEST", { severity: "critical", insufficientData: true, title: "Insufficient data: no valid English test", detail: "No valid IELTS/PTE/Duolingo/TOEFL result or MOI is recorded.", fix: "Book a test or obtain an MOI letter if the university accepts it.", askStudent: "Have you taken an English test? Can your university issue an MOI letter?", refs: [{ type: "missing", label: "English test" }] });
  } else {
    const scored = valid.filter((t) => t.type !== "MOI");
    const pass = scored.find(
      (t) =>
        (t.type === "IELTS" && req.ielts != null && (t.overall ?? 0) >= req.ielts) ||
        (t.type === "PTE" && req.pte != null && (t.overall ?? 0) >= req.pte) ||
        (t.type === "Duolingo" && req.duolingo != null && (t.overall ?? 0) >= req.duolingo),
    );
    const moi = valid.find((t) => t.type === "MOI");
    if (pass) {
      R.add("Language", "MEETS", { severity: "info", title: `${pass.type} ${pass.overall} meets the requirement`, detail: `Requirement: ${[req.ielts && `IELTS ${req.ielts}`, req.pte && `PTE ${req.pte}`, req.duolingo && `Duolingo ${req.duolingo}`].filter(Boolean).join(" / ")}.`, refs: [{ type: "field", id: pass.id, label: `${pass.type} result` }] });
      const ielts = scored.find((t) => t.type === "IELTS");
      if (ielts && req.ielts && [ielts.listening, ielts.reading, ielts.writing, ielts.speaking].some((b) => b != null && b < req.ielts! - 0.5)) {
        R.add("Language", "LOW_BAND", { severity: "warning", title: "One or more IELTS bands below the usual minimum", detail: "Many programmes require a minimum per band (often overall − 0.5).", fix: "Check the per-band rule for this programme.", refs: [{ type: "field", id: ielts.id, label: "IELTS bands" }], confidence: "medium" });
      }
    } else if (moi && req.moiAccepted) {
      R.add("Language", "MOI", { severity: kase.country === "UK" ? "warning" : "info", title: "Relying on MOI (Medium of Instruction)", detail: "University accepts MOI. For UK, expect a credibility/English interview; the visa officer may still test English.", refs: [{ type: "field", id: moi.id, label: "MOI" }], confidence: "medium" });
    } else {
      const best = scored.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
      R.add("Language", "BELOW", {
        severity: "critical",
        hardFail: true,
        title: best ? `${best.type} ${best.overall} does not meet the requirement` : "MOI not accepted for this programme",
        detail: `Requirement: ${[req.ielts && `IELTS ${req.ielts}`, req.pte && `PTE ${req.pte}`, req.duolingo && `Duolingo ${req.duolingo}`].filter(Boolean).join(" / ") || "test score"}${req.moiAccepted ? "" : "; MOI not accepted"}.`,
        fix: "Retake the English test, or choose a programme/pathway with a lower requirement.",
        refs: [{ type: "programme", id: kase.programmeId, label: kase.programmeName }, ...(best ? [{ type: "field" as const, id: best.id, label: `${best.type} result` }] : [])],
      });
    }
  }

  // ---------------- Financial ----------------
  const requirement = computeFundsRequirement(kase, ctx);
  for (const n of requirement.notes) R.add("Financial", "REQ_NOTE", { severity: "warning", insufficientData: true, title: "Funds requirement incomplete", detail: n, refs: [{ type: "rule", label: "funds rules" }], confidence: "low" });
  const fundsDue = isDueNow("file_visa", kase.stage, horizon);
  const blockedCheck = kase.country === "DE" ? kase.countryChecks["blocked_account"] : undefined;
  if (financial) {
    for (const id of financial.ruleIdsUsed) {
      const r = input.rules.find((x) => x.id === id);
      if (r) ctx.used.set(r.id, r);
    }
    const analysisRef: ReasonRef = { type: "analysis", id: financial.id, label: "Financial analysis" };
    if (!financial.passes) {
      const main = financial.problems.find((p) => p.severity === "critical");
      R.add("Financial", "FUNDS_FAIL", {
        severity: "critical",
        hardFail: fundsDue,
        title: financial.firstFailure ? `Funds test fails on day ${financial.firstFailure.dayIndex} of the holding window` : "Funds test fails",
        detail: (main?.message ?? "Funds evidence does not meet the requirement.") + (fundsDue ? "" : ` Must be fixed before the visa is filed.`),
        fix: financial.fixActions[0],
        refs: [analysisRef, ...requirement.lines.filter((l) => l.ruleId).map((l) => ({ type: "rule" as const, id: l.ruleId, label: l.ruleKey ?? l.label }))],
      });
    } else {
      R.add("Financial", "FUNDS_OK", { severity: "info", title: "Funds meet the requirement for the full holding window", detail: `Lowest balance ${financial.lowestBalance ? formatMoney(financial.lowestBalance.amount, financial.statementCurrency) : "—"} vs required ${formatMoney(financial.requiredInStatementCurrency, financial.statementCurrency)}.`, refs: [analysisRef] });
    }
    const unexplained = financial.largeDeposits.filter((d) => !d.explained);
    if (unexplained.length) {
      R.add("Financial", "UNEXPLAINED_DEPOSITS", {
        severity: "critical",
        title: `${unexplained.length} large deposit(s) without source-of-funds evidence`,
        detail: unexplained.map((d) => `${formatMoney(d.amount, financial.statementCurrency)} on ${formatDate(d.date)} (${d.ratioToPriorAverage}× prior average)`).join("; ") + ". NEEDS MANUAL VERIFICATION — funds must be lawful, traceable and belong to the student/family.",
        fix: "Collect genuine evidence of where the money came from and have a staff member verify it.",
        askStudent: "Where did these deposits come from? Please share documents (sale deed, salary, business income).",
        refs: [analysisRef],
      });
    }
    if (financial.sourceOfFundsMissing) {
      R.add("Financial", "NO_SOURCE", { severity: "warning", title: "Source-of-funds evidence missing", detail: "No sponsor income / source-of-funds document is linked.", fix: "Upload sponsor income evidence.", refs: [{ type: "missing", label: DOC_LABELS.sponsor_income }] });
    }
  } else if (blockedCheck?.status === "complete") {
    R.add("Financial", "BLOCKED_OK", { severity: "info", title: "Blocked account confirmed", detail: `Requirement ${formatMoney(requirement.total, requirement.currency)}; confirmation recorded ${formatDate(blockedCheck.date)}.`, refs: requirement.lines.map((l) => ({ type: "rule" as const, id: l.ruleId, label: l.ruleKey ?? l.label })) });
  } else {
    R.add("Financial", "NOT_ANALYSED", {
      severity: fundsDue ? "critical" : "warning",
      insufficientData: true,
      title: "Insufficient data: funds not yet analysed",
      detail: `Required: ${formatMoney(requirement.total, requirement.currency)}. No bank statement analysis on file.`,
      fix: "Upload the bank statement and run the financial analyzer.",
      refs: [{ type: "missing", label: "Bank statement analysis" }],
    });
  }
  if (student.budget.totalPKR) {
    // UK and FR requirements already include tuition; DE/IT requirements are living costs only.
    const living = convert(requirement.total, requirement.currency, "PKR", ctx);
    const firstYearTuition = (Math.max(0, kase.tuitionFee.amount - kase.tuitionPaid) * 12) / Math.max(12, kase.courseMonths);
    const tuitionOutstanding = convert(firstYearTuition, kase.tuitionFee.currency, "PKR", ctx);
    if (living && tuitionOutstanding) {
      const needPKR = living.amount + (kase.country === "DE" || kase.country === "IT" ? tuitionOutstanding.amount : 0);
      if (student.budget.totalPKR < needPKR) {
        R.add("Financial", "BUDGET_SHORT", { severity: "warning", title: "Declared budget is below the estimated first-year cost", detail: `Budget ${formatMoney(student.budget.totalPKR, "PKR")} vs estimated ${formatMoney(Math.round(needPKR), "PKR")} (tuition + required funds, stored FX rate).`, askStudent: "Can the family cover the full first-year cost?", refs: [{ type: "field", label: "Budget" }], confidence: "medium" });
      }
    }
  }

  // ---------------- Documents ----------------
  const required = requiredDocsFor(kase.country, kase.level);
  for (const d of required) {
    const have = documents.filter((x) => x.docType === d.docType && x.reviewStatus !== "rejected");
    const due = isDueNow(d.neededBefore, kase.stage, horizon);
    if (!have.length) {
      if (d.optional) continue;
      R.add("Documents", `MISSING_${d.docType}`, {
        severity: due ? "critical" : "info",
        insufficientData: due,
        title: `${due ? "Missing" : "To collect"}: ${d.label}`,
        detail: due ? `Needed before you ${horizonLabel}.` : `Needed before: ${ACTION_LABELS[d.neededBefore].toLowerCase()}.`,
        askStudent: `Please upload your ${d.label.toLowerCase()}.`,
        refs: [{ type: "missing", label: d.label }],
      });
    } else if (due && have.every((x) => x.reviewStatus === "pending")) {
      R.add("Documents", `UNREVIEWED_${d.docType}`, { severity: "warning", title: `${d.label} not yet verified by staff`, detail: "AI extraction is not a verification. A staff member must review it.", refs: have.map((x) => ({ type: "document" as const, id: x.id, label: x.fileName })) });
    }
  }
  for (const doc of documents) {
    for (const f of doc.flags.filter((f) => !f.resolved)) {
      if (f.severity === "info") continue;
      R.add("Documents", `FLAG_${f.code}`, {
        severity: f.severity,
        hardFail: f.code === "EXPIRED" && doc.docType === "passport",
        title: `${DOC_LABELS[doc.docType]}: ${f.code.replace(/_/g, " ").toLowerCase()}`,
        detail: f.message,
        fix: f.needsManualVerification ? "A staff member must verify and resolve this flag with a note." : undefined,
        refs: [{ type: "document", id: doc.id, label: doc.fileName }],
        confidence: "medium",
      });
    }
  }
  if (student.personal.passportExpiry) {
    const courseEnd = addDays(kase.intakeStartDate, Math.round(kase.courseMonths * 30.4));
    if (isBefore(student.personal.passportExpiry, today)) {
      R.add("Documents", "PASSPORT_EXPIRED", { severity: "critical", hardFail: true, title: "Passport has expired", detail: `Expired ${formatDate(student.personal.passportExpiry)}.`, fix: "Renew the passport before any application.", refs: [{ type: "field", label: "Passport expiry" }] });
    } else if (isBefore(student.personal.passportExpiry, courseEnd)) {
      R.add("Documents", "PASSPORT_SHORT", { severity: "warning", title: "Passport expires before the course ends", detail: `Expires ${formatDate(student.personal.passportExpiry)}; course ends ~${formatDate(courseEnd)}.`, fix: "Renew before filing the visa.", refs: [{ type: "field", label: "Passport expiry" }] });
    }
  }

  // ---------------- Timeline ----------------
  if (isBefore(kase.intakeStartDate, today)) {
    R.add("Timeline", "INTAKE_PASSED", { severity: "critical", hardFail: true, title: "Intake has already started", detail: `Intake started ${formatDate(kase.intakeStartDate)}.`, fix: "Move the case to a later intake.", refs: [{ type: "field", label: "Intake" }] });
  }
  const preSubmit = horizon === "pay_fee" || horizon === "submit_application";
  if (kase.applicationDeadline && preSubmit) {
    const left = daysBetween(today, kase.applicationDeadline);
    if (left < 0) R.add("Timeline", "DEADLINE_PASSED", { severity: "critical", hardFail: true, title: "University application deadline has passed", detail: `Deadline was ${formatDate(kase.applicationDeadline)}.`, fix: "Choose a later intake or another programme.", refs: [{ type: "field", label: "Application deadline" }] });
    else if (left <= 14) R.add("Timeline", "DEADLINE_SOON", { severity: "warning", title: `Application deadline in ${left} days`, detail: `Deadline ${formatDate(kase.applicationDeadline)}.`, refs: [{ type: "field", label: "Application deadline" }] });
  }
  let visaDeadline: string | undefined;
  for (const dk of country.deadlineRuleKeys) {
    const r = ctx.get(dk.key);
    if (!r || typeof r.value !== "string") continue;
    visaDeadline = r.value;
    if (horizon === null) continue;
    const left = daysBetween(today, r.value);
    if (left < 0) R.add("Timeline", "COUNTRY_DEADLINE_PASSED", { severity: "critical", hardFail: true, title: `${dk.label} has passed`, detail: `Deadline was ${formatDate(r.value)}.`, refs: ruleRef(r) });
    else if (left <= 45) R.add("Timeline", "COUNTRY_DEADLINE_SOON", { severity: "warning", title: `${dk.label}: ${left} days left`, detail: `Deadline ${formatDate(r.value)} (from rules table).`, fix: "Book the appointment now and finish all country gates.", refs: ruleRef(r) });
  }
  for (const a of attestations) {
    const tpl = country.attestation.find((t) => t.label === a.documentLabel) ?? country.attestation[0];
    const neededBy =
      tpl?.neededBefore === "submit_application"
        ? kase.applicationDeadline ?? addDays(kase.intakeStartDate, -90)
        : kase.plannedVisaApplicationDate ?? visaDeadline ?? addDays(kase.intakeStartDate, -45);
    const res = chainFinishesBefore(a.steps, neededBy, today);
    const pending = a.steps.filter((s) => s.status !== "completed" && s.status !== "not_required");
    if (!pending.length) continue;
    if (!res.ok) {
      R.add("Timeline", "ATTESTATION_LATE", {
        severity: "critical",
        hardFail: true,
        title: `Attestation chain for ${a.documentLabel} cannot finish in time`,
        detail: `Expected completion ${formatDate(res.eta)} (${pending.map((s) => s.authority).join(" → ")} pending) but needed by ${formatDate(neededBy)} — ${Math.abs(res.slackDays)} days late.`,
        fix: "Move to a later intake, or confirm with the university whether provisional documents are accepted.",
        refs: [{ type: "field", id: a.id, label: `Attestation: ${a.documentLabel}` }],
        confidence: "medium",
      });
    } else if (res.slackDays < 21) {
      R.add("Timeline", "ATTESTATION_TIGHT", { severity: "warning", title: `Attestation for ${a.documentLabel} has only ${res.slackDays} days slack`, detail: `ETA ${formatDate(res.eta)}, needed by ${formatDate(neededBy)}.`, fix: "Escalate the pending step now.", refs: [{ type: "field", id: a.id, label: `Attestation: ${a.documentLabel}` }], confidence: "medium" });
    }
  }
  if (country.attestation.length && attestations.length === 0) {
    R.add("Timeline", "ATTESTATION_UNTRACKED", { severity: "warning", title: "Attestation chain not started", detail: `${country.name} requires ${country.attestation.map((t) => `${t.label}: ${t.steps.join(" → ")}`).join("; ")}.`, fix: "Create attestation trackers and submit the first step.", refs: [{ type: "missing", label: "Attestation tracker" }] });
  }

  // ---------------- Credibility ----------------
  for (const r of student.refusals) {
    const same = r.country.toLowerCase().includes(country.name.toLowerCase()) || r.country.toUpperCase() === kase.country;
    R.add("Credibility", "REFUSAL", {
      severity: same ? "critical" : "warning",
      title: `Previous visa refusal: ${r.country} ${r.year}`,
      detail: `${r.reason ?? "Reason not recorded"}. Refusals must be declared and addressed in the new application.`,
      fix: "Address each refusal reason explicitly with new evidence.",
      askStudent: r.reason ? undefined : "Please share the refusal letter.",
      refs: [{ type: "field", id: r.id, label: "Refusal history" }],
    });
  }
  if (!documents.some((d) => d.docType === "sop") && isDueNow("submit_application", kase.stage, horizon)) {
    R.add("Credibility", "NO_SOP", { severity: "warning", title: "SOP not uploaded", detail: "Credibility cannot be assessed without the statement of purpose.", refs: [{ type: "missing", label: "SOP" }], insufficientData: true });
  }
  if (!student.tiesToPakistan?.trim()) {
    R.add("Credibility", "TIES", { severity: "info", title: "Ties to Pakistan not recorded", detail: "Family, property, job offers or career plans in Pakistan support genuine intent.", askStudent: "What brings you back to Pakistan after your studies (family, job offer, property, business)?", refs: [{ type: "field", label: "Ties to Pakistan" }], insufficientData: true, confidence: "low" });
  }
  if (kase.country === "UK") {
    const r = ctx.get("compliance.pakistan_scrutiny");
    if (r) R.add("Credibility", "UK_COMPLIANCE", { severity: "info", title: "UK sponsor compliance pressure", detail: String(r.value), refs: ruleRef(r), confidence: "medium" });
  }

  // ---------------- Country gates ----------------
  for (const chk of country.checks) {
    if (chk.ruleKey) {
      const rb = ctx.bool(chk.ruleKey, true);
      if (!rb.value) continue;
    }
    const st = kase.countryChecks[chk.key]?.status ?? "not_started";
    if (st === "complete" || st === "not_required") continue;
    const due = isDueNow(chk.requiredBefore, kase.stage, horizon);
    const ruleR = chk.ruleKey ? ctx.get(chk.ruleKey) : undefined;
    if (due) {
      R.add("Country", `GATE_${chk.key}`, {
        severity: chk.blocking ? "critical" : "warning",
        hardFail: chk.blocking,
        title: `${chk.label}: ${st === "in_progress" ? "in progress" : "not done"}`,
        detail: `${chk.help} Required before you ${ACTION_LABELS[chk.requiredBefore as keyof typeof ACTION_LABELS].toLowerCase()}.`,
        fix: `Complete "${chk.label}" and record the date/reference on the case.`,
        refs: [...ruleRef(ruleR), { type: "missing", label: chk.label }],
      });
    } else if (chk.requiredBefore !== "none") {
      R.add("Country", `UPCOMING_${chk.key}`, { severity: "info", title: `Upcoming: ${chk.label}`, detail: `Needed before: ${ACTION_LABELS[chk.requiredBefore].toLowerCase()}.`, refs: [...ruleRef(ruleR)] });
    }
  }

  // ---------------- Rule health ----------------
  const ruleIssues = ctx.issues();
  for (const i of ruleIssues) {
    R.add("Rules", `RULE_${i.key}`, {
      severity: "warning",
      title: `Rule needs verification: ${i.key} (${i.problem})`,
      detail: i.problem === "Missing" ? `No rule "${i.key}" exists for ${kase.country}. Results depending on it are not trustworthy.` : `This case depends on a rule that is ${i.problem.toLowerCase()}. A manager must verify it against the official source before this case can be GREEN.`,
      fix: "Manager: open Rules, check the official source and click “Mark verified” (or correct the value).",
      refs: i.ruleId ? [{ type: "rule", id: i.ruleId, label: i.key }] : [{ type: "missing", label: `rule ${i.key}` }],
    });
  }

  // ---------------- Light & score ----------------
  const reasons = R.list;
  const hard = reasons.filter((r) => r.hardFail);
  const criticalFlags = reasons.filter((r) => r.severity === "critical" && !r.hardFail).length;
  let light: Light;
  let lightReason: string;
  if (hard.length) {
    light = "RED";
    lightReason = hard[0].title;
  } else if (ruleIssues.length) {
    light = "AMBER";
    lightReason = "Rule needs verification";
  } else if (reasons.some((r) => r.severity !== "info")) {
    light = "AMBER";
    lightReason = criticalFlags ? `${criticalFlags} critical item(s) need manual verification` : "Warnings to review";
  } else {
    light = "GREEN";
    lightReason = "All checks passed on verified rules";
  }

  const scoreOf = (rs: Reason[]) => Math.max(0, 100 - rs.reduce((a, r) => a + (r.hardFail ? 30 : SEVERITY_WEIGHT[r.severity]), 0));
  let score = scoreOf(reasons);
  if (light === "RED") score = Math.min(score, 39);
  if (light === "AMBER") score = Math.min(Math.max(score, 40), 79);

  const categoryScores: EligibilityComputation["categoryScores"] = {};
  const cats: ReasonCategory[] = ["Academic", "Language", "Financial", "Documents", "Timeline", "Credibility", "Country", "Rules"];
  for (const c of cats) {
    const rs = reasons.filter((r) => r.category === c);
    if (!rs.length) continue;
    const cl: Light = rs.some((r) => r.hardFail) ? "RED" : rs.some((r) => r.severity !== "info") ? "AMBER" : "GREEN";
    categoryScores[c] = { score: scoreOf(rs), light: cl };
  }

  // sort: hard fails, critical, warning, info
  const rank = (r: Reason) => (r.hardFail ? 0 : r.severity === "critical" ? 1 : r.severity === "warning" ? 2 : 3);
  reasons.sort((a, b) => rank(a) - rank(b));

  return {
    caseId: kase.id,
    studentId: student.id,
    dataVersion: kase.dataVersion,
    fingerprint: fingerprintOf(light, reasons, ruleIssues),
    score,
    light,
    lightReason,
    criticalFlags,
    reasons,
    categoryScores,
    ruleIdsUsed: [...ctx.used.keys()],
    ruleIssues,
    engineVersion: ENGINE_VERSION,
  };
}

/** Top-N risks for the one-screen report (excludes info). */
export function topRisks(reasons: Reason[], n = 5): Reason[] {
  return reasons.filter((r) => r.severity !== "info").slice(0, n);
}
