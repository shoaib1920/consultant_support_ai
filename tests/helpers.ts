import type { Rule, RuleStatus, RuleValue } from "@/domain/types";

export function rule(country: Rule["country"], key: string, value: RuleValue, extra: Partial<Rule> = {}): Rule {
  return {
    id: `r_${country}_${key}`,
    organizationId: "org_t",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    country,
    level: "*",
    intake: "*",
    key,
    label: key,
    value,
    unit: "",
    sourceUrl: "https://example.org",
    status: "Verified" as RuleStatus,
    lastVerifiedAt: "2026-10-20T00:00:00Z",
    verifiedBy: "test",
    ...extra,
  };
}

export const TODAY = "2026-10-28";

export const BASE_RULES: Rule[] = [
  rule("UK", "funds.maintenance_monthly_london", 1529),
  rule("UK", "funds.maintenance_monthly_outside_london", 1171),
  rule("UK", "funds.max_months", 9),
  rule("DE", "funds.blocked_account_yearly", 11904),
  rule("DE", "funds.blocked_account_monthly", 992),
  rule("IT", "funds.yearly", 10179.85),
  rule("IT", "funds.repatriation", 1000),
  rule("FR", "funds.monthly", 615),
  rule("FR", "funds.tuition_one_year_required", true),
  rule("*", "fx.GBP_PKR", 378.5),
  rule("*", "fx.EUR_PKR", 325.4),
];
