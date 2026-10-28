import { describe, expect, it } from "vitest";
import { computeFundsRequirement, convert, type FundsInput } from "@/domain/funds";
import { RuleContext } from "@/domain/rules";
import type { CountryCode } from "@/domain/types";
import { BASE_RULES, TODAY, rule } from "./helpers";

const ctx = (country: CountryCode, rules = BASE_RULES, intake = "2027-01") => new RuleContext(rules, { country, level: "master", intake }, TODAY);
const input = (p: Partial<FundsInput> & Pick<FundsInput, "country">): FundsInput => ({ courseMonths: 12, tuitionFee: { amount: 0, currency: "GBP" }, tuitionPaid: 0, inLondon: false, level: "master", ...p });

describe("funds formulas", () => {
  it("UK outside London: tuition balance + £1,171 × 9 months (cap)", () => {
    const r = computeFundsRequirement(input({ country: "UK", tuitionFee: { amount: 17000, currency: "GBP" }, tuitionPaid: 5000 }), ctx("UK"));
    expect(r.currency).toBe("GBP");
    expect(r.total).toBe(12000 + 1171 * 9);
  });

  it("UK London: £1,529 × min(course months, 9)", () => {
    const r = computeFundsRequirement(input({ country: "UK", inLondon: true, courseMonths: 6, tuitionFee: { amount: 9000, currency: "GBP" } }), ctx("UK"));
    expect(r.total).toBe(9000 + 1529 * 6);
  });

  it("UK: courses longer than 12 months only test the first year of tuition", () => {
    const r = computeFundsRequirement(input({ country: "UK", courseMonths: 24, tuitionFee: { amount: 40000, currency: "GBP" } }), ctx("UK"));
    expect(r.total).toBe(20000 + 1171 * 9);
  });

  it("Germany: blocked account €11,904 per year", () => {
    const r = computeFundsRequirement(input({ country: "DE", courseMonths: 24 }), ctx("DE"));
    expect(r.total).toBe(11904);
    expect(r.notes).toHaveLength(0); // 992 × 12 == 11904
  });

  it("Germany: warns when monthly and yearly rules disagree", () => {
    const rules = BASE_RULES.map((x) => (x.key === "funds.blocked_account_monthly" ? { ...x, value: 1000 } : x));
    expect(computeFundsRequirement(input({ country: "DE" }), ctx("DE", rules)).notes[0]).toMatch(/does not equal/);
  });

  it("Italy: €10,179.85 per year plus repatriation funds", () => {
    const r = computeFundsRequirement(input({ country: "IT", courseMonths: 24 }), ctx("IT"));
    expect(r.total).toBeCloseTo(11179.85, 2);
  });

  it("France: €615 × months (max 12) + one year of unpaid tuition", () => {
    const r = computeFundsRequirement(input({ country: "FR", courseMonths: 24, tuitionFee: { amount: 7758, currency: "EUR" } }), ctx("FR"));
    expect(r.total).toBe(615 * 12 + 3879);
  });

  it("all amounts come from rules: changing a rule changes the requirement", () => {
    const rules = BASE_RULES.map((x) => (x.key === "funds.monthly" ? { ...x, value: 877.5 } : x));
    const r = computeFundsRequirement(input({ country: "FR", courseMonths: 12, tuitionFee: { amount: 0, currency: "EUR" } }), ctx("FR", rules));
    expect(r.total).toBe(877.5 * 12);
  });

  it("missing rule => incomplete requirement with an 'insufficient data' note (no guessing)", () => {
    const r = computeFundsRequirement(input({ country: "UK" }), ctx("UK", BASE_RULES.filter((x) => x.key !== "funds.max_months")));
    expect(r.notes[0]).toMatch(/insufficient data/);
  });

  it("converts with the stored FX rule, directly or inversely", () => {
    const c = ctx("UK");
    expect(convert(100, "GBP", "PKR", c)?.amount).toBe(37850);
    expect(convert(37850, "PKR", "GBP", c)?.amount).toBeCloseTo(100, 6);
    expect(convert(1, "USD", "PKR", c)).toBeUndefined();
  });

  it("scopes UK maintenance rules by academic year", () => {
    const rules = [...BASE_RULES.filter((x) => !x.key.startsWith("funds.maintenance")), rule("UK", "funds.maintenance_monthly_outside_london", 1171, { intake: "2026-27" })];
    const ok = computeFundsRequirement(input({ country: "UK" }), ctx("UK", rules, "2027-01"));
    expect(ok.notes).toHaveLength(0);
    const nextYear = new RuleContext(rules, { country: "UK", level: "master", intake: "2027-09" }, TODAY);
    expect(computeFundsRequirement(input({ country: "UK" }), nextYear).notes[0]).toMatch(/insufficient data/);
  });
});
