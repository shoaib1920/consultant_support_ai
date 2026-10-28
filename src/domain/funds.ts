// Funds requirement formulas per country. Every figure comes from the Rules table via
// RuleContext, so admins can update amounts without code changes.

import type { RuleContext } from "./rules";
import type { Case, CountryCode, Currency, FundsRequirement, FundsRequirementLine } from "./types";

export type FundsInput = Pick<Case, "country" | "courseMonths" | "tuitionFee" | "tuitionPaid" | "inLondon" | "level">;

export function computeFundsRequirement(c: FundsInput, ctx: RuleContext): FundsRequirement {
  switch (c.country) {
    case "UK":
      return ukFunds(c, ctx);
    case "DE":
      return deFunds(c, ctx);
    case "IT":
      return itFunds(c, ctx);
    case "FR":
      return frFunds(c, ctx);
  }
}

function finish(country: CountryCode, currency: Currency, lines: FundsRequirementLine[], notes: string[]): FundsRequirement {
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { country, currency, total, lines, notes, ruleIdsUsed: lines.map((l) => l.ruleId).filter(Boolean) as string[] };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ukFunds(c: FundsInput, ctx: RuleContext): FundsRequirement {
  const notes: string[] = [];
  const lines: FundsRequirementLine[] = [];
  const tuitionBalance = Math.max(0, (c.tuitionFee.currency === "GBP" ? c.tuitionFee.amount : 0) - (c.tuitionPaid || 0));
  // UK tests only the first year of tuition for courses longer than a year.
  const firstYear = c.courseMonths > 12 ? round2((tuitionBalance * 12) / c.courseMonths) : tuitionBalance;
  lines.push({ label: c.courseMonths > 12 ? "Tuition balance (first year, as on CAS)" : "Tuition balance (as on CAS)", amount: firstYear, currency: "GBP" });

  const key = c.inLondon ? "funds.maintenance_monthly_london" : "funds.maintenance_monthly_outside_london";
  const monthly = ctx.num(key);
  const maxMonths = ctx.num("funds.max_months");
  if (!monthly || !maxMonths) {
    notes.push("Maintenance rule missing — requirement incomplete (insufficient data).");
  } else {
    const months = Math.min(Math.ceil(c.courseMonths), maxMonths.value);
    lines.push({
      label: `Maintenance ${c.inLondon ? "(London)" : "(outside London)"} £${monthly.value.toLocaleString("en-GB")} × ${months} months`,
      amount: round2(monthly.value * months),
      currency: "GBP",
      ruleId: monthly.rule.id,
      ruleKey: key,
    });
  }
  return finish("UK", "GBP", lines, notes);
}

function deFunds(_c: FundsInput, ctx: RuleContext): FundsRequirement {
  const notes: string[] = [];
  const lines: FundsRequirementLine[] = [];
  const yearly = ctx.num("funds.blocked_account_yearly");
  const monthly = ctx.num("funds.blocked_account_monthly");
  if (!yearly) notes.push("Blocked-account rule missing — requirement incomplete (insufficient data).");
  else {
    lines.push({ label: "Blocked account (Sperrkonto) — 12 months", amount: yearly.value, currency: "EUR", ruleId: yearly.rule.id, ruleKey: "funds.blocked_account_yearly" });
    if (monthly && Math.abs(monthly.value * 12 - yearly.value) > 1) {
      notes.push(`Monthly rule (€${monthly.value}) × 12 does not equal yearly rule (€${yearly.value}) — verify rules table.`);
    }
  }
  return finish("DE", "EUR", lines, notes);
}

function itFunds(_c: FundsInput, ctx: RuleContext): FundsRequirement {
  const notes: string[] = [];
  const lines: FundsRequirementLine[] = [];
  const yearly = ctx.num("funds.yearly");
  const repatriation = ctx.num("funds.repatriation");
  if (!yearly) notes.push("Italy yearly funds rule missing (insufficient data).");
  else {
    // Means are assessed per academic year of stay, independent of total course length.
    lines.push({ label: "Means of subsistence (academic year)", amount: round2(yearly.value), currency: "EUR", ruleId: yearly.rule.id, ruleKey: "funds.yearly" });
  }
  if (!repatriation) notes.push("Repatriation funds rule missing (insufficient data).");
  else lines.push({ label: "Funds for repatriation", amount: repatriation.value, currency: "EUR", ruleId: repatriation.rule.id, ruleKey: "funds.repatriation" });
  return finish("IT", "EUR", lines, notes);
}

function frFunds(c: FundsInput, ctx: RuleContext): FundsRequirement {
  const notes: string[] = [];
  const lines: FundsRequirementLine[] = [];
  const monthly = ctx.num("funds.monthly");
  const tuitionRule = ctx.bool("funds.tuition_one_year_required", true);
  if (!monthly) notes.push("France monthly funds rule missing (insufficient data).");
  else {
    const months = Math.min(12, Math.ceil(c.courseMonths));
    lines.push({ label: `Living costs €${monthly.value} × ${months} months`, amount: round2(monthly.value * months), currency: "EUR", ruleId: monthly.rule.id, ruleKey: "funds.monthly" });
  }
  if (tuitionRule.value) {
    const yearlyTuition = c.tuitionFee.currency === "EUR" ? (c.tuitionFee.amount * 12) / Math.max(12, c.courseMonths) : 0;
    const balance = Math.max(0, round2(yearlyTuition - (c.tuitionPaid || 0)));
    lines.push({ label: "One year of tuition (unpaid balance)", amount: balance, currency: "EUR", ruleId: tuitionRule.rule?.id, ruleKey: "funds.tuition_one_year_required" });
  }
  return finish("FR", "EUR", lines, notes);
}

/** Convert using a stored FX rule `fx.<FROM>_<TO>` (e.g. fx.GBP_PKR). */
export function convert(amount: number, from: Currency, to: Currency, ctx: RuleContext): { amount: number; rate: number; ruleId?: string; date?: string } | undefined {
  if (from === to) return { amount, rate: 1 };
  const direct = ctx.has(`fx.${from}_${to}`) ? ctx.num(`fx.${from}_${to}`) : undefined;
  if (direct) return { amount: round2(amount * direct.value), rate: direct.value, ruleId: direct.rule.id, date: direct.rule.lastVerifiedAt };
  const inverse = ctx.num(`fx.${to}_${from}`);
  if (inverse) return { amount: round2(amount / inverse.value), rate: 1 / inverse.value, ruleId: inverse.rule.id, date: inverse.rule.lastVerifiedAt };
  return undefined;
}

export function formatMoney(amount: number, currency: Currency): string {
  const sym: Record<Currency, string> = { GBP: "£", EUR: "€", USD: "$", PKR: "PKR " };
  return `${sym[currency]}${amount.toLocaleString("en-GB", { maximumFractionDigits: currency === "PKR" ? 0 : 2 })}`;
}
