import { COUNTRIES } from "@/domain/countries";
import { ruleProblem } from "@/domain/rules";
import { computeDeadlines } from "@/domain/tasks";
import type { Attestation, Case, CountryCode, Deadline, FinancialAnalysis, GateEvent, Payment, Rule, Stage, Student, User } from "@/domain/types";
import { STAGES } from "@/domain/types";
import type { Repo } from "../db";

export interface OwnerDashboard {
  pipeline: { stage: Stage; count: number }[];
  lights: { GREEN: number; AMBER: number; RED: number; none: number };
  blockedCases: { caseId: string; studentName: string; country: CountryCode; reason: string; light?: string }[];
  moneySavedPKR: number;
  blockedAttempts: number;
  moneyExposedPKR: number;
  refusalReasons: { reason: string; count: number }[];
  riskCategories: { category: string; count: number }[];
  officerStats: { userId: string; name: string; attempts: number; blocked: number; errorRate: number }[];
  conversion: { country: CountryCode; name: string; cases: number; submitted: number; visaFiled: number; approved: number; refused: number }[];
  deadlines: (Deadline & { studentName: string })[];
  staleRules: { id: string; key: string; country: string; problem: string }[];
  totals: { cases: number; students: number; payments: number; nonRefundablePKR: number };
}

const AT_OR_AFTER = (s: Stage, ref: Stage) => STAGES.indexOf(s) >= STAGES.indexOf(ref);

export async function ownerDashboard(repo: Repo, organizationId: string): Promise<OwnerDashboard> {
  const org: [string, "==", string] = ["organizationId", "==", organizationId];
  const [cases, events, payments, rules, users, students, attestations, financials] = await Promise.all([
    repo.list<Case>("cases", [org]),
    repo.list<GateEvent>("gateEvents", [org]),
    repo.list<Payment>("payments", [org]),
    repo.list<Rule>("rules", [org]),
    repo.list<User>("users", [org]),
    repo.list<Student>("students", [org]),
    repo.list<Attestation>("attestations", [org]),
    repo.list<FinancialAnalysis>("financialAnalyses", [org], { orderBy: "createdAt", desc: true }),
  ]);

  const pipeline = STAGES.map((stage) => ({ stage, count: cases.filter((c) => c.stage === stage).length }));
  const lights = { GREEN: 0, AMBER: 0, RED: 0, none: 0 };
  for (const c of cases) lights[c.light ?? "none"]++;

  const blocked = events.filter((e) => e.type === "blocked");
  // money protected: one entry per case+action (largest attempted non-refundable amount)
  const saved = new Map<string, number>();
  for (const e of blocked) if (e.amountAtRisk) saved.set(`${e.caseId}:${e.action}`, Math.max(saved.get(`${e.caseId}:${e.action}`) ?? 0, e.amountAtRisk.amountPKR));
  const moneySavedPKR = [...saved.values()].reduce((a, b) => a + b, 0);

  const riskyCase = (c: Case) => c.light === "RED" || (c.criticalFlags ?? 0) > 0;
  const moneyExposedPKR = payments.filter((p) => !p.refundable && p.status !== "void" && p.status !== "refunded" && riskyCase(cases.find((c) => c.id === p.caseId) ?? ({} as Case))).reduce((a, p) => a + p.amountPKR, 0);

  const blockedCases = cases
    .filter((c) => c.light === "RED" || blocked.some((e) => e.caseId === c.id && Date.now() - Date.parse(e.createdAt) < 30 * 86_400_000))
    .map((c) => ({ caseId: c.id, studentName: c.studentName, country: c.country, light: c.light, reason: blocked.filter((e) => e.caseId === c.id).at(-1)?.blockers?.[0] ?? "RED: gate closed" }));

  const refusalMap = new Map<string, number>();
  for (const c of cases.filter((c) => c.decision?.outcome === "refused")) refusalMap.set(c.decision?.reason ?? "Not recorded", (refusalMap.get(c.decision?.reason ?? "Not recorded") ?? 0) + 1);
  const riskMap = new Map<string, number>();
  const blockerText = blocked.flatMap((e) => e.blockers ?? []);
  for (const b of blockerText) {
    const cat = /cgpa|grade|academic/i.test(b) ? "Academic" : /fund|deposit|statement/i.test(b) ? "Financial" : /rule/i.test(b) ? "Unverified rules" : /document|flag|verified by staff/i.test(b) ? "Documents" : /override|acknowledg|RED|AMBER/i.test(b) ? "Risk status" : /pre-flight|irreversible/i.test(b) ? "Process (pre-flight)" : "Other";
    riskMap.set(cat, (riskMap.get(cat) ?? 0) + 1);
  }

  const officerStats = users
    .filter((u) => u.role === "officer" || u.role === "manager" || u.role === "counsellor")
    .map((u) => {
      const mine = events.filter((e) => e.by === u.id && (e.type === "blocked" || e.type === "preflight_started" || e.type === "transition"));
      const b2 = mine.filter((e) => e.type === "blocked").length;
      return { userId: u.id, name: u.name, attempts: mine.length, blocked: b2, errorRate: mine.length ? Math.round((b2 / mine.length) * 100) : 0 };
    })
    .filter((s) => s.attempts > 0)
    .sort((a, b) => b.errorRate - a.errorRate);

  const conversion = (Object.keys(COUNTRIES) as CountryCode[]).map((k) => {
    const cs = cases.filter((c) => c.country === k);
    return {
      country: k,
      name: COUNTRIES[k].name,
      cases: cs.length,
      submitted: cs.filter((c) => AT_OR_AFTER(c.stage, "Submitted")).length,
      visaFiled: cs.filter((c) => AT_OR_AFTER(c.stage, "Visa Filed")).length,
      approved: cs.filter((c) => c.decision?.outcome === "approved").length,
      refused: cs.filter((c) => c.decision?.outcome === "refused").length,
    };
  });

  const deadlines = cases
    .flatMap((c) => {
      const s = students.find((x) => x.id === c.studentId);
      if (!s) return [];
      const fa = financials.find((f) => f.caseId === c.id);
      return computeDeadlines(c, s, fa, attestations.filter((a) => a.caseId === c.id), rules).map((d) => ({ ...d, studentName: c.studentName }));
    })
    .filter((d) => d.daysLeft >= -7 && d.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 15);

  const staleRules = rules.map((r) => ({ r, p: ruleProblem(r) })).filter((x) => x.p).map(({ r, p }) => ({ id: r.id, key: r.key, country: r.country, problem: p! }));

  return {
    pipeline,
    lights,
    blockedCases,
    moneySavedPKR,
    blockedAttempts: blocked.length,
    moneyExposedPKR,
    refusalReasons: [...refusalMap].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    riskCategories: [...riskMap].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    officerStats,
    conversion,
    deadlines,
    staleRules,
    totals: { cases: cases.length, students: students.length, payments: payments.length, nonRefundablePKR: payments.filter((p) => !p.refundable && p.status !== "void").reduce((a, p) => a + p.amountPKR, 0) },
  };
}
