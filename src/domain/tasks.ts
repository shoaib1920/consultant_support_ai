// Auto-generated task lists and countdowns per case. Idempotent via templateKey.

import { AUTHORITY_LABELS, chainEta } from "./attestation";
import { COUNTRIES, DOC_LABELS, isDueNow, requiredDocsFor } from "./countries";
import { addDays, daysBetween, todayISO } from "./dates";
import { findRule } from "./rules";
import type { Attestation, Case, Deadline, DocumentRecord, FinancialAnalysis, Rule, Severity, Stage, Student } from "./types";

export interface TaskTemplate {
  templateKey: string;
  title: string;
  detail?: string;
  dueDate?: string;
  stage?: Stage;
}

const STAGE_TASKS: Partial<Record<Stage, { key: string; title: string; detail: string; dueInDays: number }[]>> = {
  Lead: [
    { key: "profile", title: "Complete the student profile", detail: "Education with grading scale, English test, sponsor, gaps, refusals.", dueInDays: 3 },
    { key: "consent", title: "Record data-processing consent", detail: "Tick the consent box at intake.", dueInDays: 1 },
  ],
  "Profile Complete": [{ key: "collect-docs", title: "Collect and verify documents against the checklist", detail: "Every document must be reviewed by staff; AI extraction is not verification.", dueInDays: 7 }],
  "Docs Verified": [{ key: "assess", title: "Run eligibility and financial analysis", detail: "Resolve every RED item before requesting manager approval.", dueInDays: 2 }],
  "Eligibility Passed": [{ key: "mgr-review", title: "Manager review of the Refusal Risk Report", detail: "Manager approves or sends back.", dueInDays: 2 }],
  "Manager Approved": [{ key: "preflight-pay", title: "Pre-flight: authorise the non-refundable application fee", detail: "Officer + Manager double confirmation.", dueInDays: 3 }],
  "Payment Authorized": [{ key: "submit", title: "Submit the university application", detail: "Through pre-flight; check deadline.", dueInDays: 5 }],
  Submitted: [{ key: "follow-up", title: "Follow up with the university on the decision", detail: "Log any requests for additional documents.", dueInDays: 14 }],
  "Offer/Admission": [{ key: "visa-prep", title: "Prepare the visa file and complete country gates", detail: "Every country gate must be complete before filing.", dueInDays: 10 }],
  "Visa Filed": [{ key: "track", title: "Track the visa decision", detail: "Record outcome and reasons (for refusal analytics).", dueInDays: 21 }],
  Decision: [{ key: "predeparture", title: "Pre-departure briefing", detail: "Travel, accommodation, arrival formalities.", dueInDays: 7 }],
};

export function generateTasks(kase: Case, documents: DocumentRecord[], attestations: Attestation[], financial: FinancialAnalysis | undefined, today: string = todayISO()): TaskTemplate[] {
  const out: TaskTemplate[] = [];
  for (const t of STAGE_TASKS[kase.stage] ?? []) out.push({ templateKey: `stage:${kase.stage}:${t.key}`, title: t.title, detail: t.detail, dueDate: addDays(today, t.dueInDays), stage: kase.stage });

  for (const req of requiredDocsFor(kase.country, kase.level)) {
    if (req.optional) continue;
    const have = documents.some((d) => d.docType === req.docType && d.reviewStatus !== "rejected");
    if (!have && isDueNow(req.neededBefore, kase.stage)) out.push({ templateKey: `doc:${req.docType}`, title: `Collect: ${req.label}`, detail: `Needed before the next irreversible step.`, dueDate: addDays(today, 5) });
    const pending = documents.filter((d) => d.docType === req.docType && d.reviewStatus === "pending");
    if (pending.length) out.push({ templateKey: `review:${req.docType}`, title: `Review & verify: ${DOC_LABELS[req.docType]}`, detail: "Check AI-extracted fields and flags, then mark verified.", dueDate: addDays(today, 2) });
  }
  for (const d of documents) {
    for (const f of d.flags.filter((f) => !f.resolved && f.needsManualVerification)) {
      out.push({ templateKey: `flag:${d.id}:${f.id}`, title: `Manual verification: ${d.fileName}`, detail: f.message, dueDate: addDays(today, 2) });
    }
  }
  for (const chk of COUNTRIES[kase.country].checks) {
    const st = kase.countryChecks[chk.key]?.status ?? "not_started";
    if (st === "complete" || st === "not_required" || chk.requiredBefore === "none") continue;
    out.push({ templateKey: `check:${chk.key}`, title: chk.label, detail: chk.help, dueDate: isDueNow(chk.requiredBefore, kase.stage) ? addDays(today, 7) : undefined });
  }
  for (const a of attestations) {
    const next = a.steps.find((s) => s.status === "not_started");
    if (next) out.push({ templateKey: `attest:${a.id}:${next.authority}`, title: `Submit ${a.documentLabel} to ${AUTHORITY_LABELS[next.authority]}`, detail: `Expected ${next.expectedDays} days.`, dueDate: addDays(today, 3) });
  }
  if (financial && !financial.passes) out.push({ templateKey: `funds:${financial.id}`, title: "Fix funds evidence", detail: financial.fixActions.join(" "), dueDate: addDays(today, 3) });
  return out;
}

function sev(daysLeft: number): Severity {
  if (daysLeft <= 14) return "critical";
  if (daysLeft <= 45) return "warning";
  return "info";
}

export function computeDeadlines(kase: Case, student: Student, financial: FinancialAnalysis | undefined, attestations: Attestation[], rules: Rule[], today: string = todayISO()): Deadline[] {
  const out: Deadline[] = [];
  const push = (key: string, label: string, date?: string) => {
    if (!date) return;
    const daysLeft = daysBetween(today, date);
    out.push({ key, label, date, daysLeft, severity: sev(daysLeft), caseId: kase.id });
  };
  push("intake", `Intake starts (${kase.universityName})`, kase.intakeStartDate);
  if (["Lead", "Profile Complete", "Docs Verified", "Eligibility Passed", "Manager Approved", "Payment Authorized"].includes(kase.stage)) push("app-deadline", "University application deadline", kase.applicationDeadline);
  for (const dk of COUNTRIES[kase.country].deadlineRuleKeys) {
    const r = findRule(rules, dk.key, { country: kase.country, level: kase.level, intake: kase.intake });
    if (r && typeof r.value === "string") push(dk.key, dk.label, r.value);
  }
  if (financial?.window) {
    push("funds-window", `28-day funds window ends; statement valid for application until`, addDays(financial.window.end, 31));
    if (financial.earliestCompliantApplicationDate) push("funds-restart", "Earliest application date after restarting the funds count", financial.earliestCompliantApplicationDate);
  }
  push("passport", "Passport expiry", student.personal.passportExpiry);
  for (const t of student.englishTests.filter((t) => t.type !== "MOI" && t.testDate)) push(`eng-${t.id}`, `${t.type} result validity (2 years)`, t.expiryDate ?? addDays(t.testDate!, 730));
  for (const a of attestations) {
    if (a.steps.every((s) => s.status === "completed" || s.status === "not_required")) continue;
    push(`attest-${a.id}`, `Attestation ETA: ${a.documentLabel}`, chainEta(a.steps, today).eta);
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
