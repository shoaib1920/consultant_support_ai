import { beforeAll, describe, expect, it } from "vitest";
import { computeEligibility } from "@/domain/eligibility";
import { academicYear, findRule, isStale, ruleBadge, ruleProblem } from "@/domain/rules";
import type { Rule } from "@/domain/types";
import { MemoryRepo } from "@/server/db/memory";
import { setRepo } from "@/server/db";
import { seedDemo } from "@/server/seed/seed";
import { loadCaseBundle } from "@/server/services/bundle";
import { rule } from "./helpers";

describe("rule staleness", () => {
  it("is stale after 60 days, fresh at 60", () => {
    expect(isStale({ lastVerifiedAt: "2026-08-29T10:00:00Z" }, "2026-10-28")).toBe(false); // 60 days
    expect(isStale({ lastVerifiedAt: "2026-08-28T10:00:00Z" }, "2026-10-28")).toBe(true); // 61 days
    expect(isStale({ lastVerifiedAt: undefined }, "2026-10-28")).toBe(true);
  });

  it("reports Conflicting > Unverified > Stale and badges accordingly", () => {
    expect(ruleProblem(rule("FR", "k", 1, { status: "Conflicting" }), "2026-10-28")).toBe("Conflicting");
    expect(ruleProblem(rule("FR", "k", 1, { status: "Unverified" }), "2026-10-28")).toBe("Unverified");
    expect(ruleProblem(rule("FR", "k", 1, { lastVerifiedAt: "2026-01-01T00:00:00Z" }), "2026-10-28")).toBe("Stale");
    expect(ruleBadge(rule("FR", "k", 1, { lastVerifiedAt: "2026-01-01T00:00:00Z" }), "2026-10-28").label).toBe("STALE");
    expect(ruleProblem(rule("FR", "k", 1), "2026-10-28")).toBeNull();
  });

  it("picks the most specific rule (country > level > intake)", () => {
    const rules: Rule[] = [rule("*", "x", 1), rule("UK", "x", 2), { ...rule("UK", "x", 3), id: "lvl", level: "master" }, { ...rule("UK", "x", 4), id: "ay", level: "master", intake: "2026-27" }];
    expect(findRule(rules, "x", { country: "UK", level: "master", intake: "2027-01" })?.value).toBe(4);
    expect(findRule(rules, "x", { country: "UK", level: "master", intake: "2027-09" })?.value).toBe(3);
    expect(findRule(rules, "x", { country: "UK", level: "bachelor" })?.value).toBe(2);
    expect(findRule(rules, "x", { country: "DE" })?.value).toBe(1);
  });

  it("maps intakes to academic years", () => {
    expect(academicYear("2026-09")).toBe("2026-27");
    expect(academicYear("2027-01")).toBe("2026-27");
    expect(academicYear("2027-08")).toBe("2027-28");
  });
});

describe("a case can never be GREEN on an unverified, conflicting or stale rule", () => {
  let base: Awaited<ReturnType<typeof loadCaseBundle>>;
  beforeAll(async () => {
    const repo = new MemoryRepo();
    setRepo(repo);
    await seedDemo(repo);
    base = await loadCaseBundle(repo, "org_demo", "cs_6_green");
  }, 60_000);

  const run = (rules: Rule[]) => computeEligibility({ student: base.student, kase: base.kase, rules, programme: base.programme, documents: base.documents, attestations: base.attestations, financial: base.financial });

  it("the reference case is GREEN with verified rules", () => {
    expect(run(base.rules).light).toBe("GREEN");
  });

  for (const [label, patch] of [
    ["Unverified", { status: "Unverified" as const }],
    ["Conflicting", { status: "Conflicting" as const }],
    ["Stale", { lastVerifiedAt: "2026-01-01T00:00:00Z" }],
  ] as const) {
    it(`turns AMBER "Rule needs verification" when a dependency is ${label}`, () => {
      const rules = base.rules.map((r) => (r.key === "funds.maintenance_monthly_outside_london" ? { ...r, ...patch } : r));
      const e = run(rules);
      expect(e.light).toBe("AMBER");
      expect(e.lightReason).toBe("Rule needs verification");
      expect(e.ruleIssues.map((i) => i.key)).toContain("funds.maintenance_monthly_outside_london");
    });
  }

  it("a missing rule also prevents GREEN", () => {
    const e = run(base.rules.filter((r) => r.key !== "fx.GBP_PKR"));
    expect(e.light).not.toBe("GREEN");
  });

  it("rules the case does not depend on do not affect it", () => {
    const rules = base.rules.map((r) => (r.country === "FR" ? { ...r, status: "Conflicting" as const } : r));
    expect(run(rules).light).toBe("GREEN");
  });
});
