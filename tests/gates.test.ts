import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { GateError, transitionBlockers } from "@/domain/gates";
import type { Approval, Case, GateEvent, Payment } from "@/domain/types";
import type { Actor } from "@/server/auth/session";
import { signPayload } from "@/server/crypto";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { seedDemo } from "@/server/seed/seed";
import { gateContext, loadCaseBundle } from "@/server/services/bundle";
import { confirmPreflight, grantOverride, signRiskAcknowledgment, startPreflight, transitionCase } from "@/server/services/gates";
import { recordRefundablePayment } from "@/server/services/payments";
import { verifyRule } from "@/server/services/rules";
import { POST as transitionRoute } from "@/app/api/cases/[id]/transition/route";
import { POST as paymentsRoute } from "@/app/api/cases/[id]/payments/route";

const officer: Actor = { id: "us_officer", name: "Sana Riaz", email: "o@x", role: "officer", organizationId: "org_demo" };
const officer2: Actor = { id: "us_officer2", name: "Usman Tariq", email: "o2@x", role: "officer", organizationId: "org_demo" };
const manager: Actor = { id: "us_manager", name: "Bilal Ahmed", email: "m@x", role: "manager", organizationId: "org_demo" };
const owner: Actor = { id: "us_owner", name: "Ayesha Malik", email: "ow@x", role: "owner", organizationId: "org_demo" };
const studentHamza: Actor = { id: "us_st_hamza", name: "Hamza Iqbal", email: "h@x", role: "student", organizationId: "org_demo", studentId: "st_hamza" };
const yes = { reviewedWarnings: true, checkedAmount: true };
const SIG = "data:image/png;base64," + "A".repeat(200);

let repo: MemoryRepo;

beforeEach(async () => {
  repo = new MemoryRepo();
  setRepo(repo);
  await seedDemo(repo);
}, 60_000);

const kase = (id: string) => repo.get<Case>("cases", id) as Promise<Case>;

describe("gate enforcement — the original incident", () => {
  it("a low-CGPA case is RED and the non-refundable fee cannot be authorised", async () => {
    expect((await kase("cs_1_lowcgpa")).light).toBe("RED");
    await expect(startPreflight(repo, officer, "cs_1_lowcgpa", "pay_fee", { type: "application_fee", amount: 100, currency: "GBP", refundable: false }, yes)).rejects.toBeInstanceOf(GateError);
    const payments = await repo.list<Payment>("payments", [["caseId", "==", "cs_1_lowcgpa"]]);
    expect(payments).toHaveLength(0);
  });

  it("records blocked attempts with the money at risk (for 'money protected')", async () => {
    const ev = await repo.list<GateEvent>("gateEvents", [["caseId", "==", "cs_1_lowcgpa"], ["type", "==", "blocked"]]);
    expect(ev.some((e) => (e.amountAtRisk?.amountPKR ?? 0) > 1_000_000)).toBe(true);
  });

  it("the blocker list cites the CGPA rule", async () => {
    try {
      await transitionCase(repo, officer, "cs_1_lowcgpa", "Eligibility Passed");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GateError);
      expect((e as GateError).blockers.join(" ")).toMatch(/Manager override/);
    }
  });
});

describe("no bypass", () => {
  it("irreversible stages can never be reached by a direct transition — even by the owner", async () => {
    await expect(transitionCase(repo, owner, "cs_6_green", "Payment Authorized")).rejects.toBeInstanceOf(GateError);
    expect((await kase("cs_6_green")).stage).toBe("Manager Approved");
  });

  it("skipping stages is refused", async () => {
    await expect(transitionCase(repo, manager, "cs_3_germany", "Submitted")).rejects.toBeInstanceOf(GateError);
  });

  it("students cannot change stages", async () => {
    await expect(transitionCase(repo, studentHamza, "cs_1_lowcgpa", "Eligibility Passed")).rejects.toThrow();
  });

  it("non-refundable payments cannot be recorded outside pre-flight", async () => {
    await expect(recordRefundablePayment(repo, officer, "cs_6_green", { type: "application_fee", amount: 100, currency: "GBP", refundable: false })).rejects.toBeInstanceOf(GateError);
  });

  it("the REST transition endpoint refuses irreversible stages (409) and records the attempt", async () => {
    const token = signPayload({ uid: "us_owner", exp: Date.now() + 60_000 });
    const req = new NextRequest("http://localhost/api/cases/cs_6_green/transition", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ to: "Payment Authorized" }) });
    const res = await transitionRoute(req, { params: Promise.resolve({ id: "cs_6_green" }) });
    expect(res.status).toBe(409);
    expect((await kase("cs_6_green")).stage).toBe("Manager Approved");
    const ev = await repo.list<GateEvent>("gateEvents", [["caseId", "==", "cs_6_green"], ["type", "==", "blocked"]]);
    expect(ev.length).toBeGreaterThan(0);
  });

  it("the REST endpoint rejects forged tokens", async () => {
    const req = new NextRequest("http://localhost/api/cases/cs_6_green/transition", { method: "POST", headers: { authorization: "Bearer eyJ1aWQiOiJ1c19vd25lciJ9.forged" }, body: JSON.stringify({ to: "Payment Authorized" }) });
    expect((await transitionRoute(req, { params: Promise.resolve({ id: "cs_6_green" }) })).status).toBe(401);
  });

  it("the REST payments endpoint refuses non-refundable money", async () => {
    const token = signPayload({ uid: "us_officer", exp: Date.now() + 60_000 });
    const req = new NextRequest("http://localhost/api/cases/cs_6_green/payments", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type: "visa_fee", amount: 524, currency: "GBP", refundable: false }) });
    expect((await paymentsRoute(req, { params: Promise.resolve({ id: "cs_6_green" }) })).status).toBe(409);
  });

  it("cross-organisation access is denied", async () => {
    await expect(transitionCase(repo, { ...manager, organizationId: "org_other" }, "cs_6_green", "Payment Authorized")).rejects.toThrow();
  });

  it("Firestore rules deny client writes to every gated collection and to case stages", () => {
    const rules = fs.readFileSync("firestore.rules", "utf8");
    for (const c of ["gateEvents", "approvals", "payments", "riskAcknowledgments", "eligibilityResults", "auditLog", "rules"]) {
      expect(rules).toMatch(new RegExp(`match /${c}/\\{id\\}[^}]*allow (create, update, delete|write): if false`, "s"));
    }
    expect(rules).toMatch(/unchanged\(\['stage', 'stageHistory'/);
  });
});

describe("pre-flight double confirmation", () => {
  it("GREEN case: officer + a different manager execute the payment and advance the stage", async () => {
    const ap = await startPreflight(repo, officer, "cs_6_green", "pay_fee", { type: "tuition_deposit", amount: 2000, currency: "GBP", refundable: false, payee: "Caledon deposit" }, yes);
    expect(ap.status).toBe("pending_manager");
    expect((await kase("cs_6_green")).stage).toBe("Manager Approved");
    const done = await confirmPreflight(repo, manager, ap.id, { understandsNonRefundable: true });
    expect(done.status).toBe("executed");
    const c = await kase("cs_6_green");
    expect(c.stage).toBe("Payment Authorized");
    const pays = await repo.list<Payment>("payments", [["caseId", "==", "cs_6_green"], ["refundable", "==", false]]);
    expect(pays).toHaveLength(1);
    expect(pays[0].authorizedBy).toEqual(["us_officer", "us_manager"]);
    expect(pays[0].amountPKR).toBe(757_000);
  });

  it("the same person cannot confirm twice; officers cannot confirm as manager", async () => {
    const ap = await startPreflight(repo, manager, "cs_6_green", "pay_fee", { type: "application_fee", amount: 50, currency: "GBP", refundable: false }, yes);
    await expect(confirmPreflight(repo, manager, ap.id, { understandsNonRefundable: true })).rejects.toBeInstanceOf(GateError);
    await expect(confirmPreflight(repo, officer2, ap.id, { understandsNonRefundable: true })).rejects.toThrow(/not allowed/);
  });

  it("requires the confirmation checkboxes", async () => {
    await expect(startPreflight(repo, officer, "cs_6_green", "pay_fee", { type: "application_fee", amount: 50, currency: "GBP", refundable: false }, { reviewedWarnings: false, checkedAmount: true })).rejects.toBeInstanceOf(GateError);
  });

  it("re-checks at execution: if the case turns RED after the officer step, nothing executes", async () => {
    const ap = await startPreflight(repo, officer, "cs_6_green", "pay_fee", { type: "application_fee", amount: 50, currency: "GBP", refundable: false }, yes);
    await repo.update<Case>("cases", "cs_6_green", { minCGPA4: 3.9, dataVersion: 99 }); // requirement changes underneath
    await expect(confirmPreflight(repo, manager, ap.id, { understandsNonRefundable: true })).rejects.toBeInstanceOf(GateError);
    expect((await kase("cs_6_green")).stage).toBe("Manager Approved");
    expect(await repo.list<Payment>("payments", [["caseId", "==", "cs_6_green"], ["refundable", "==", false]])).toHaveLength(0);
  });
});

describe("override + student risk acknowledgment", () => {
  it("RED requires a manager override with a written reason AND the student's signature", async () => {
    await expect(grantOverride(repo, manager, "cs_1_lowcgpa", "too short")).rejects.toBeInstanceOf(GateError);
    await expect(grantOverride(repo, officer, "cs_1_lowcgpa", "x".repeat(40))).rejects.toThrow(/not allowed/);
    const { ack } = await grantOverride(repo, manager, "cs_1_lowcgpa", "University confirmed in writing that 2.45 is accepted with work experience (email on file).");
    let b = await loadCaseBundle(repo, "org_demo", "cs_1_lowcgpa");
    expect(transitionBlockers(gateContext(b), "Eligibility Passed", { actorId: officer.id, actorRole: "officer" }).join(" ")).toMatch(/not signed/);
    await expect(signRiskAcknowledgment(repo, studentHamza, ack.id, { signedName: "Someone Else", signatureDataUrl: SIG, agree: true })).rejects.toBeInstanceOf(GateError);
    await expect(signRiskAcknowledgment(repo, officer, ack.id, { signedName: "Hamza Iqbal", signatureDataUrl: SIG, agree: true })).rejects.toThrow();
    await signRiskAcknowledgment(repo, studentHamza, ack.id, { signedName: "Hamza Iqbal", signatureDataUrl: SIG, agree: true });
    b = await loadCaseBundle(repo, "org_demo", "cs_1_lowcgpa");
    expect(transitionBlockers(gateContext(b), "Eligibility Passed", { actorId: officer.id, actorRole: "officer" })).toEqual([]);
    const c = await transitionCase(repo, officer, "cs_1_lowcgpa", "Eligibility Passed");
    expect(c.stage).toBe("Eligibility Passed");
  });

  it("the override is void as soon as the assessment changes materially", async () => {
    const { ack } = await grantOverride(repo, manager, "cs_1_lowcgpa", "University confirmed in writing that 2.45 is accepted with work experience (email on file).");
    await signRiskAcknowledgment(repo, studentHamza, ack.id, { signedName: "Hamza Iqbal", signatureDataUrl: SIG, agree: true });
    await repo.update<Case>("cases", "cs_1_lowcgpa", { englishRequirement: { ielts: 8.0 }, dataVersion: 50 });
    await expect(transitionCase(repo, officer, "cs_1_lowcgpa", "Eligibility Passed")).rejects.toBeInstanceOf(GateError);
  });

  it("overrides cannot bypass unverified rules; verifying the rule unblocks", async () => {
    const fr = await kase("cs_5_france");
    expect(fr.light).toBe("AMBER");
    await expect(startPreflight(repo, officer, "cs_5_france", "file_visa", undefined, yes)).rejects.toThrow(GateError);
    await verifyRule(repo, manager, "ru_seed_" + String((await repo.list<{ id: string; key: string; country: string }>("rules")).findIndex((r) => r.key === "funds.monthly" && r.country === "FR")).padStart(3, "0"));
    expect((await kase("cs_5_france")).light).toBe("GREEN");
    const ap = await startPreflight(repo, officer, "cs_5_france", "file_visa", { type: "visa_fee", amount: 99, currency: "EUR", refundable: false }, yes);
    const exec = await confirmPreflight(repo, manager, ap.id, { understandsNonRefundable: true });
    expect(exec.status).toBe("executed");
    expect((await kase("cs_5_france")).stage).toBe("Visa Filed");
    const approvals = await repo.list<Approval>("approvals", [["caseId", "==", "cs_5_france"], ["status", "==", "executed"]]);
    expect(approvals.length).toBeGreaterThan(0);
  });
});
