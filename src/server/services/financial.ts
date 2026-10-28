// Financial analyzer service: funds requirement (rules) + statement analysis (deterministic).

import { type DepositExplanation, type StatementInput, analyzeStatement } from "@/domain/bank";
import { addDays, daysBetween, todayISO } from "@/domain/dates";
import { computeFundsRequirement, convert, round2 } from "@/domain/funds";
import { RuleContext } from "@/domain/rules";
import type { BankTransaction, Currency, ExtractedFields, FinancialAnalysis } from "@/domain/types";
import { assertCan, type Actor } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import { type AuditActor, audit } from "./audit";
import { type CaseBundle, NotFoundError, loadCaseBundle } from "./bundle";
import { ValidationError } from "./documents";
import { refreshCase } from "./eligibility";
import { syncTasks } from "./tasks";

export interface ManualStatement {
  currency: Currency;
  accountHolder?: string;
  bankName?: string;
  openingBalance: number;
  statementStart: string;
  statementEnd: string;
  transactions: BankTransaction[];
}

export function buildAnalysis(b: CaseBundle, s: StatementInput & { accountHolder?: string; bankName?: string }, applicationDate: string, explanations: DepositExplanation[], inputMode: FinancialAnalysis["inputMode"], documentId: string | undefined, organizationId: string): FinancialAnalysis {
  const ctx = new RuleContext(b.rules, { country: b.kase.country, level: b.kase.level, intake: b.kase.intake });
  const requirement = computeFundsRequirement(b.kase, ctx);
  const holding = ctx.num("funds.holding_days");
  const maxAge = ctx.num("funds.statement_max_age_days");
  const ratio = ctx.num("policy.large_deposit_ratio");
  const fx = convert(requirement.total, requirement.currency, s.currency, ctx);
  const required = fx ? round2(fx.amount) : requirement.total;
  const a = analyzeStatement(s, required, applicationDate, {
    holdingDays: holding?.value ?? 28,
    windowEndMaxDaysBeforeApplication: maxAge?.value ?? 31,
    largeDepositRatio: ratio?.value ?? 0.5,
  }, explanations);
  const problems = [...a.problems];
  if (!fx && requirement.currency !== s.currency) problems.unshift({ severity: "critical", code: "NO_FX", message: `No stored FX rate for ${requirement.currency}→${s.currency}. Add rule fx.${requirement.currency}_${s.currency}.` });
  const sourceOfFundsMissing = !b.documents.some((d) => d.docType === "sponsor_income" && d.reviewStatus !== "rejected");
  const now = nowISO();
  return {
    id: newId("fa_"),
    organizationId,
    createdAt: now,
    updatedAt: now,
    caseId: b.kase.id,
    studentId: b.kase.studentId,
    documentId,
    inputMode,
    statementCurrency: s.currency,
    accountHolder: s.accountHolder,
    bankName: s.bankName,
    statementStart: s.statementStart,
    statementEnd: s.statementEnd,
    applicationDate,
    requirement,
    fx: fx ? { from: requirement.currency, to: s.currency, rate: fx.rate, date: fx.date ?? todayISO(), ruleId: fx.ruleId } : undefined,
    requiredInStatementCurrency: required,
    window: a.window,
    lowestBalance: a.lowestBalance,
    firstFailure: a.firstFailure,
    lastFailureDate: a.lastFailureDate,
    earliestCompliantApplicationDate: a.earliestCompliantApplicationDate,
    statementAgeDays: a.statementAgeDays,
    largeDeposits: a.largeDeposits,
    sourceOfFundsMissing,
    passes: a.passes && !!fx,
    problems,
    fixActions: sourceOfFundsMissing ? [...a.fixActions, "Upload sponsor income / source-of-funds evidence (salary slips, tax returns, business or property records)."] : a.fixActions,
    dailyBalances: a.dailyBalances,
    ruleIdsUsed: [...ctx.used.keys()],
    isBlockedAccount: b.kase.country === "DE",
  };
}

async function save(repo: Repo, actor: AuditActor, fa: FinancialAnalysis) {
  await repo.transaction(async (tx) => {
    await tx.set("financialAnalyses", fa.id, fa);
    await audit(tx, actor, { action: "financial.analyzed", entity: "financialAnalyses", entityId: fa.id, caseId: fa.caseId, after: { passes: fa.passes, required: fa.requiredInStatementCurrency, currency: fa.statementCurrency, lowest: fa.lowestBalance, firstFailure: fa.firstFailure, mode: fa.inputMode } });
  });
  await refreshCase(repo, actor, fa.caseId);
  await syncTasks(repo, actor, fa.caseId);
  return fa;
}

function validateStatement(s: ManualStatement) {
  if (daysBetween(s.statementStart, s.statementEnd) < 0) throw new ValidationError("Statement end must be after start.");
  if (daysBetween(s.statementStart, s.statementEnd) > 400) throw new ValidationError("Statement period too long (max ~13 months).");
  for (const t of s.transactions) if (t.date < s.statementStart || t.date > s.statementEnd) throw new ValidationError(`Transaction on ${t.date} is outside the statement period.`);
}

export async function analyzeManual(repo: Repo, actor: Actor, caseId: string, s: ManualStatement, applicationDate: string, explanations: DepositExplanation[] = []) {
  assertCan(actor, "analysis.run");
  validateStatement(s);
  const b = await loadCaseBundle(repo, actor.organizationId, caseId);
  return save(repo, actor, buildAnalysis(b, s, applicationDate, explanations, "manual", undefined, actor.organizationId));
}

export async function analyzeFromDocument(repo: Repo, actor: Actor, caseId: string, documentId: string, applicationDate: string, explanations: DepositExplanation[] = []) {
  assertCan(actor, "analysis.run");
  const b = await loadCaseBundle(repo, actor.organizationId, caseId);
  const doc = b.documents.find((d) => d.id === documentId && d.docType === "bank_statement");
  if (!doc) throw new NotFoundError("Bank statement document");
  const ef = await repo.get<ExtractedFields>("extractedFields", `ef_${documentId}`);
  const txs = ef?.transactions ?? [];
  if (!ef || !txs.length) throw new ValidationError("No transactions were extracted from this statement. Use manual entry.");
  const sorted = [...txs].sort((a, b2) => a.date.localeCompare(b2.date));
  const first = sorted[0];
  const s: ManualStatement = {
    currency: ((ef.fields.currency as Currency) ?? "PKR") as Currency,
    accountHolder: ef.fields.accountHolder as string | undefined,
    bankName: ef.fields.bankName as string | undefined,
    openingBalance: typeof ef.fields.openingBalance === "number" ? ef.fields.openingBalance : round2(first.balance - first.amount),
    statementStart: (ef.fields.statementStart as string) ?? first.date,
    statementEnd: (ef.fields.statementEnd as string) ?? sorted[sorted.length - 1].date,
    transactions: sorted,
  };
  validateStatement(s);
  return save(repo, actor, buildAnalysis(b, s, applicationDate, explanations, ef.source === "claude" ? "ai" : ef.source === "mock" ? "mock" : "manual", documentId, actor.organizationId));
}

export function defaultApplicationDate(b: CaseBundle): string {
  return b.kase.plannedVisaApplicationDate ?? addDays(todayISO(), 7);
}

