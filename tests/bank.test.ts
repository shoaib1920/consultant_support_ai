import { describe, expect, it } from "vitest";
import { analyzeStatement, dailyBalances, type StatementInput } from "@/domain/bank";
import { addDays } from "@/domain/dates";

const POLICY = { holdingDays: 28, windowEndMaxDaysBeforeApplication: 31, largeDepositRatio: 0.5 };

function flat(start: string, end: string, balance: number, txs: StatementInput["transactions"] = []): StatementInput {
  return { currency: "PKR", openingBalance: balance, statementStart: start, statementEnd: end, transactions: txs };
}

describe("28-day funds window", () => {
  it("passes when the balance never drops below the requirement for 28 consecutive days", () => {
    const s = flat("2026-09-01", "2026-10-20", 10_000_000);
    const a = analyzeStatement(s, 9_000_000, "2026-10-25", POLICY);
    expect(a.passes).toBe(true);
    expect(a.window).toEqual({ start: "2026-09-23", end: "2026-10-20", days: 28 });
    expect(a.lowestBalance?.amount).toBe(10_000_000);
  });

  it("reports the exact day the funds test fails (day 19) and the lowest balance", () => {
    const end = "2026-10-26";
    const start = addDays(end, -27); // window start = day 1
    const day19 = addDays(start, 18);
    const day22 = addDays(start, 21);
    const s = flat("2026-08-01", end, 9_500_000, [
      { date: day19, description: "Withdrawal", amount: -1_500_000, balance: 8_000_000 },
      { date: day22, description: "Deposit back", amount: 1_500_000, balance: 9_500_000 },
    ]);
    const a = analyzeStatement(s, 8_531_011.5, "2026-10-30", POLICY);
    expect(a.passes).toBe(false);
    expect(a.firstFailure?.dayIndex).toBe(19);
    expect(a.firstFailure?.date).toBe(day19);
    expect(a.firstFailure?.shortfall).toBeCloseTo(531_011.5, 1);
    expect(a.lowestBalance).toEqual({ amount: 8_000_000, date: day19 });
    expect(a.lastFailureDate).toBe(addDays(day22, -1));
    // restart the count the day after the last failing day
    expect(a.earliestCompliantApplicationDate).toBe(addDays(addDays(day22, -1), 28));
    expect(a.fixActions[0]).toMatch(/day 19/);
    expect(a.fixActions[0]).toMatch(/restart the 28-day count/);
  });

  it("fails when the 28-day period ends more than 31 days before the application date", () => {
    const s = flat("2026-07-01", "2026-09-01", 20_000_000);
    const a = analyzeStatement(s, 1_000_000, "2026-10-05", POLICY); // 34 days
    expect(a.statementAgeDays).toBe(34);
    expect(a.passes).toBe(false);
    expect(a.problems.map((p) => p.code)).toContain("STATEMENT_TOO_OLD");
  });

  it("accepts exactly 31 days between window end and application", () => {
    const s = flat("2026-07-01", "2026-09-01", 20_000_000);
    const a = analyzeStatement(s, 1_000_000, "2026-10-02", POLICY);
    expect(a.statementAgeDays).toBe(31);
    expect(a.passes).toBe(true);
  });

  it("fails when the statement does not cover 28 consecutive days", () => {
    const s = flat("2026-10-10", "2026-10-25", 20_000_000);
    const a = analyzeStatement(s, 1_000_000, "2026-10-26", POLICY);
    expect(a.passes).toBe(false);
    expect(a.problems.map((p) => p.code)).toContain("WINDOW_NOT_COVERED");
  });

  it("uses the application date as window end when the statement runs past it", () => {
    const s = flat("2026-08-01", "2026-11-15", 5_000_000);
    const a = analyzeStatement(s, 1_000_000, "2026-11-01", POLICY);
    expect(a.window?.end).toBe("2026-11-01");
    expect(a.statementAgeDays).toBe(0);
  });

  it("carries balances forward between transactions", () => {
    const d = dailyBalances(flat("2026-10-01", "2026-10-05", 100, [{ date: "2026-10-03", description: "x", amount: 50, balance: 150 }]));
    expect(d.map((x) => x.balance)).toEqual([100, 100, 150, 150, 150]);
  });

  it("flags large deposits relative to the prior 30-day average and accepts verified explanations", () => {
    const txs = [{ date: "2026-10-15", description: "IBFT from trader", amount: 3_500_000, balance: 5_000_000 }];
    const s = flat("2026-09-01", "2026-10-26", 1_500_000, txs);
    const flagged = analyzeStatement(s, 3_000_000, "2026-10-28", POLICY);
    expect(flagged.largeDeposits).toHaveLength(1);
    expect(flagged.largeDeposits[0].explained).toBe(false);
    expect(flagged.problems.some((p) => p.code === "UNEXPLAINED_DEPOSIT")).toBe(true);
    const explained = analyzeStatement(s, 3_000_000, "2026-10-28", POLICY, [{ date: "2026-10-14", amount: 3_500_000, note: "Plot sale deed verified" }]);
    expect(explained.largeDeposits[0].explained).toBe(true);
    expect(explained.problems.some((p) => p.code === "UNEXPLAINED_DEPOSIT")).toBe(false);
  });
});
