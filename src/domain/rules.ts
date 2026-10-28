// Rules engine primitives: lookup with scope specificity, staleness and health.
// A case can only be GREEN when every rule it used is Verified and not stale.

import { daysBetween, todayISO } from "./dates";
import type { CountryCode, Rule, RuleValue, StudyLevel } from "./types";

export const STALE_AFTER_DAYS = 60;

export type RuleProblem = "Unverified" | "Conflicting" | "Stale" | "Missing";

export function isStale(rule: Pick<Rule, "lastVerifiedAt">, today: string = todayISO()): boolean {
  if (!rule.lastVerifiedAt) return true;
  return daysBetween(rule.lastVerifiedAt.slice(0, 10), today) > STALE_AFTER_DAYS;
}

export function ruleProblem(rule: Rule, today: string = todayISO()): RuleProblem | null {
  if (rule.status === "Conflicting") return "Conflicting";
  if (rule.status === "Unverified") return "Unverified";
  if (isStale(rule, today)) return "Stale";
  return null;
}

export function ruleBadge(rule: Rule, today: string = todayISO()): { label: string; tone: "green" | "amber" | "red" } {
  const p = ruleProblem(rule, today);
  if (!p) return { label: "Verified", tone: "green" };
  if (p === "Conflicting") return { label: "Conflicting", tone: "red" };
  if (p === "Stale") return { label: "STALE", tone: "amber" };
  return { label: "Unverified", tone: "amber" };
}

export interface RuleScope {
  country: CountryCode;
  level?: StudyLevel;
  intake?: string; // YYYY-MM of the case
}

/** Academic-year label for an intake month, e.g. 2026-09 -> "2026-27", 2027-02 -> "2026-27". */
export function academicYear(intake?: string): string | undefined {
  if (!intake) return undefined;
  const [y, m] = intake.split("-").map(Number);
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function specificity(r: Rule): number {
  return (r.country !== "*" ? 4 : 0) + (r.level !== "*" ? 2 : 0) + (r.intake !== "*" ? 1 : 0);
}

/** Most specific rule matching scope. Country "*" rules are global (FX, internal policy). */
export function findRule(rules: Rule[], key: string, scope: RuleScope): Rule | undefined {
  const ay = academicYear(scope.intake);
  const matches = rules.filter(
    (r) =>
      r.key === key &&
      (r.country === scope.country || r.country === "*") &&
      (r.level === "*" || r.level === scope.level) &&
      (r.intake === "*" || r.intake === ay || r.intake === scope.intake),
  );
  return matches.sort((a, b) => specificity(b) - specificity(a))[0];
}

/** Collects rules used during an evaluation and reports their health. */
export class RuleContext {
  readonly used = new Map<string, Rule>();
  readonly missing = new Set<string>();
  constructor(
    private readonly rules: Rule[],
    readonly scope: RuleScope,
    readonly today: string = todayISO(),
  ) {}

  has(key: string): boolean {
    return !!findRule(this.rules, key, this.scope);
  }

  get(key: string): Rule | undefined {
    const r = findRule(this.rules, key, this.scope);
    if (r) this.used.set(r.id, r);
    else this.missing.add(key);
    return r;
  }

  num(key: string): { value: number; rule: Rule } | undefined {
    const r = this.get(key);
    if (!r) return undefined;
    const v = typeof r.value === "number" ? r.value : Number(r.value);
    return Number.isFinite(v) ? { value: v, rule: r } : undefined;
  }

  bool(key: string, fallback: boolean): { value: boolean; rule?: Rule } {
    const r = this.get(key);
    if (!r) return { value: fallback };
    return { value: coerceBool(r.value), rule: r };
  }

  issues(): { ruleId: string; key: string; problem: RuleProblem }[] {
    const out: { ruleId: string; key: string; problem: RuleProblem }[] = [];
    for (const r of this.used.values()) {
      const p = ruleProblem(r, this.today);
      if (p) out.push({ ruleId: r.id, key: r.key, problem: p });
    }
    for (const k of this.missing) out.push({ ruleId: "", key: k, problem: "Missing" });
    return out;
  }
}

export function coerceBool(v: RuleValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return ["true", "yes", "1", "required", "mandatory"].includes(String(v).trim().toLowerCase());
}

export function formatRuleValue(r: Pick<Rule, "value" | "unit">): string {
  if (typeof r.value === "number") return `${r.value.toLocaleString("en-GB")} ${r.unit}`.trim();
  if (typeof r.value === "boolean") return r.value ? "Required" : "Not required";
  return String(r.value);
}
