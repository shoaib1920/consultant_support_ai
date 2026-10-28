// Bank statement analysis: daily balances, the 28-day holding window, lowest balance,
// exact failure day, statement age and large/unexplained deposits.
// Pure and deterministic — the AI only extracts transactions; this decides.

import { addDays, daysBetween, eachDay, formatDate, isBefore } from "./dates";
import { formatMoney, round2 } from "./funds";
import type { BankTransaction, Currency, LargeDeposit, Severity } from "./types";

export interface StatementInput {
  currency: Currency;
  openingBalance: number;
  statementStart: string;
  statementEnd: string;
  transactions: BankTransaction[];
}

export interface WindowPolicy {
  holdingDays: number; // e.g. 28
  windowEndMaxDaysBeforeApplication: number; // e.g. 31
  largeDepositRatio: number; // credit / prior 30-day average balance that triggers a flag
}

export interface DepositExplanation {
  date: string;
  amount: number;
  note: string;
}

export interface StatementAnalysis {
  dailyBalances: { date: string; balance: number }[];
  window?: { start: string; end: string; days: number };
  lowestBalance?: { amount: number; date: string };
  firstFailure?: { dayIndex: number; date: string; balance: number; shortfall: number };
  lastFailureDate?: string;
  statementAgeDays: number;
  largeDeposits: LargeDeposit[];
  passes: boolean;
  problems: { severity: Severity; code: string; message: string }[];
  fixActions: string[];
  earliestCompliantApplicationDate?: string;
}

export function dailyBalances(s: StatementInput): { date: string; balance: number }[] {
  const txs = [...s.transactions].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  let bal = s.openingBalance;
  return eachDay(s.statementStart, s.statementEnd).map((date) => {
    while (i < txs.length && txs[i].date <= date) {
      bal = txs[i].balance;
      i++;
    }
    return { date, balance: bal };
  });
}

export function detectLargeDeposits(
  s: StatementInput,
  daily: { date: string; balance: number }[],
  ratio: number,
  requiredAmount: number,
  explanations: DepositExplanation[] = [],
): LargeDeposit[] {
  const out: LargeDeposit[] = [];
  for (const tx of s.transactions) {
    if (tx.amount <= 0) continue;
    const prior = daily.filter((d) => isBefore(d.date, tx.date) && daysBetween(d.date, tx.date) <= 30);
    const priorAvg = prior.length ? prior.reduce((a, d) => a + d.balance, 0) / prior.length : s.openingBalance;
    const r = priorAvg > 0 ? tx.amount / priorAvg : Infinity;
    const material = tx.amount >= requiredAmount * 0.1;
    if (r >= ratio && material) {
      const match = explanations.find((e) => Math.abs(daysBetween(e.date, tx.date)) <= 3 && Math.abs(e.amount - tx.amount) <= tx.amount * 0.05);
      out.push({
        date: tx.date,
        amount: tx.amount,
        description: tx.description,
        ratioToPriorAverage: Number.isFinite(r) ? round2(r) : 999,
        explained: !!match,
        explanation: match?.note,
      });
    }
  }
  return out;
}

/**
 * Core funds test. The holding window is the `holdingDays` consecutive days ending on the
 * statement closing date; that end date must fall within `windowEndMaxDaysBeforeApplication`
 * days of the application date. The LOWEST balance in the window is tested.
 */
export function analyzeStatement(
  s: StatementInput,
  required: number,
  applicationDate: string,
  policy: WindowPolicy,
  explanations: DepositExplanation[] = [],
): StatementAnalysis {
  const problems: StatementAnalysis["problems"] = [];
  const fixActions: string[] = [];
  const daily = dailyBalances(s);
  const money = (n: number) => formatMoney(n, s.currency);

  const end = isBefore(applicationDate, s.statementEnd) ? applicationDate : s.statementEnd;
  const statementAgeDays = daysBetween(end, applicationDate);
  const start = addDays(end, -(policy.holdingDays - 1));
  const window = { start, end, days: policy.holdingDays };
  let passes = true;

  if (statementAgeDays > policy.windowEndMaxDaysBeforeApplication) {
    passes = false;
    problems.push({
      severity: "critical",
      code: "STATEMENT_TOO_OLD",
      message: `The ${policy.holdingDays}-day period ends ${formatDate(end)}, which is ${statementAgeDays} days before the application date (maximum ${policy.windowEndMaxDaysBeforeApplication}).`,
    });
    fixActions.push(`Get a fresh statement: the ${policy.holdingDays}-day period must end no more than ${policy.windowEndMaxDaysBeforeApplication} days before you apply — or move the application date to on/before ${formatDate(addDays(end, policy.windowEndMaxDaysBeforeApplication))}.`);
  }

  if (isBefore(start, s.statementStart)) {
    passes = false;
    const covered = daysBetween(s.statementStart, end) + 1;
    problems.push({
      severity: "critical",
      code: "WINDOW_NOT_COVERED",
      message: `Statement covers only ${covered} days before ${formatDate(end)}; ${policy.holdingDays} consecutive days are required.`,
    });
    fixActions.push(`Provide a statement covering ${formatDate(start)} to ${formatDate(end)} (${policy.holdingDays} consecutive days).`);
  }

  const inWindow = daily.filter((d) => !isBefore(d.date, start) && !isBefore(end, d.date));
  let lowestBalance: StatementAnalysis["lowestBalance"];
  let firstFailure: StatementAnalysis["firstFailure"];
  let lastFailureDate: string | undefined;
  let earliestCompliantApplicationDate: string | undefined;

  if (inWindow.length) {
    const low = inWindow.reduce((m, d) => (d.balance < m.balance ? d : m));
    lowestBalance = { amount: low.balance, date: low.date };
    inWindow.forEach((d) => {
      if (d.balance < required) {
        if (!firstFailure) {
          firstFailure = { dayIndex: daysBetween(start, d.date) + 1, date: d.date, balance: d.balance, shortfall: round2(required - d.balance) };
        }
        lastFailureDate = d.date;
      }
    });
    if (firstFailure) {
      passes = false;
      earliestCompliantApplicationDate = addDays(lastFailureDate!, policy.holdingDays);
      problems.push({
        severity: "critical",
        code: "FUNDS_BELOW_REQUIREMENT",
        message: `Funds dip below the requirement on day ${firstFailure.dayIndex} of ${policy.holdingDays} (${formatDate(firstFailure.date)}): balance ${money(firstFailure.balance)} vs required ${money(required)} — shortfall ${money(firstFailure.shortfall)}. Lowest balance in window: ${money(low.balance)} on ${formatDate(low.date)}.`,
      });
      fixActions.push(
        `Funds dip below requirement on day ${firstFailure.dayIndex} — rebuild the balance to at least ${money(required)} and restart the ${policy.holdingDays}-day count. If held continuously from ${formatDate(addDays(lastFailureDate!, 1))}, the earliest compliant application date is ${formatDate(earliestCompliantApplicationDate)}.`,
      );
    }
  }

  const largeDeposits = detectLargeDeposits(s, daily, policy.largeDepositRatio, required, explanations);
  for (const d of largeDeposits.filter((x) => !x.explained)) {
    problems.push({
      severity: "warning",
      code: "UNEXPLAINED_DEPOSIT",
      message: `Large deposit of ${money(d.amount)} on ${formatDate(d.date)} ("${d.description}") is ${d.ratioToPriorAverage}× the prior 30-day average balance and has no source-of-funds evidence linked. NEEDS MANUAL VERIFICATION.`,
    });
    fixActions.push(`Collect genuine source-of-funds evidence for the ${money(d.amount)} deposit on ${formatDate(d.date)} (e.g. sale deed, salary slips, business records) and link it to the case. Do not proceed until a staff member has verified it.`);
  }

  return { dailyBalances: daily, window, lowestBalance, firstFailure, lastFailureDate, statementAgeDays, largeDeposits, passes, problems, fixActions, earliestCompliantApplicationDate };
}
