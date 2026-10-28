// Pre-launch fixes: each test pins a problem found in the launch review so it cannot come back.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GateError } from "@/domain/gates";
import type { Payment, Student } from "@/domain/types";
import { getAI, setAI } from "@/server/ai";
import type { AIProvider } from "@/server/ai";
import { demoMode, type Actor } from "@/server/auth/session";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { StudentProfileSchema } from "@/server/schemas";
import { PaymentSchema } from "@/server/schemas";
import { seedDemo } from "@/server/seed/seed";
import { confirmPreflight, startPreflight } from "@/server/services/gates";
import { rulesForNewOrg } from "@/server/services/orgs";
import { recordRefundablePayment } from "@/server/services/payments";
import { saveProfileViaToken } from "@/server/services/students";

const officer: Actor = { id: "us_officer", name: "Sana Riaz", email: "o@x", role: "officer", organizationId: "org_demo" };
const manager: Actor = { id: "us_manager", name: "Bilal Ahmed", email: "m@x", role: "manager", organizationId: "org_demo" };
const owner: Actor = { id: "us_owner", name: "Ayesha Malik", email: "ow@x", role: "owner", organizationId: "org_demo" };
const yes = { reviewedWarnings: true, checkedAmount: true };

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  (globalThis as { __vgAI?: AIProvider }).__vgAI = undefined;
});

describe("configuration defaults", () => {
  it("demo mode is opt-in: unset or anything but 'true' means live", () => {
    delete process.env.DEMO_MODE;
    expect(demoMode()).toBe(false);
    process.env.DEMO_MODE = "yes";
    expect(demoMode()).toBe(false);
    process.env.DEMO_MODE = "true";
    expect(demoMode()).toBe(true);
  });

  it("in live production without an AI key, documents are not 'read' from the student's own profile", async () => {
    (globalThis as { __vgAI?: AIProvider }).__vgAI = undefined;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEMO_MODE;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const s = { personal: { fullName: "Ali Raza" } } as Student;
    await expect(getAI().extract({ docType: "passport", bytes: Buffer.from("x"), mimeType: "application/pdf", fileName: "p.pdf", student: s })).rejects.toThrow(/not switched on/);
    setAI(undefined as unknown as AIProvider);
  });

  it("the payment schema does not turn the string 'false' into true", () => {
    expect(PaymentSchema.safeParse({ type: "visa_fee", amount: 1, currency: "GBP", refundable: "false" }).success).toBe(false);
  });
});

describe("money and gates", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepo(repo);
    await seedDemo(repo);
  }, 60_000);

  it("fees that are never refundable cannot be recorded as 'refundable' to skip pre-flight", async () => {
    for (const type of ["visa_fee", "tuition_deposit", "application_fee", "ihs"] as const) {
      await expect(recordRefundablePayment(repo, officer, "cs_6_green", { type, amount: 100, currency: "GBP", refundable: true })).rejects.toBeInstanceOf(GateError);
    }
    await expect(recordRefundablePayment(repo, officer, "cs_6_green", { type: "consultancy_fee", amount: 100, currency: "PKR", refundable: true })).resolves.toBeTruthy();
  });

  it("two simultaneous manager confirmations execute the payment only once", async () => {
    const ap = await startPreflight(repo, officer, "cs_6_green", "pay_fee", { type: "tuition_deposit", amount: 2000, currency: "GBP", refundable: false }, yes);
    const results = await Promise.allSettled([confirmPreflight(repo, manager, ap.id, { understandsNonRefundable: true }), confirmPreflight(repo, owner, ap.id, { understandsNonRefundable: true })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await repo.list<Payment>("payments", [["caseId", "==", "cs_6_green"], ["refundable", "==", false]])).toHaveLength(1);
  });
});

describe("onboarding and intake", () => {
  it("each consultancy gets its own rule documents, all starting Unverified", () => {
    const a = rulesForNewOrg("org_a");
    const b = rulesForNewOrg("org_b");
    expect(a.length).toBeGreaterThan(40);
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
    expect(a.some((r) => b.some((x) => x.id === r.id))).toBe(false);
    expect(a.every((r) => r.status === "Unverified" && !r.verifiedBy && r.organizationId === "org_a")).toBe(true);
  });

  it("an intake link works once and keeps edits staff made in the meantime", async () => {
    const repo = new MemoryRepo();
    setRepo(repo);
    await seedDemo(repo);
    const token = "demo-intake-link-saad-khan-2026";
    const s = (await repo.list<Student>("students", [["intakeToken", "==", token]]))[0];
    const input = StudentProfileSchema.parse({ personal: { ...s.personal }, education: s.education, gaps: s.gaps, englishTests: s.englishTests, work: s.work, sponsors: s.sponsors, budget: s.budget, intended: s.intended, refusals: s.refusals, travel: s.travel, tiesToPakistan: "Family business in Lahore", consentGiven: true });
    await repo.update<Student>("students", s.id, { internalNotes: "Staff note added after the link was sent" });
    await saveProfileViaToken(repo, token, input);
    const after = (await repo.get<Student>("students", s.id))!;
    expect(after.internalNotes).toBe("Staff note added after the link was sent");
    expect(after.tiesToPakistan).toBe("Family business in Lahore");
    expect(after.intakeToken).toBeUndefined();
    await expect(saveProfileViaToken(repo, token, input)).rejects.toThrow(/invalid|expired|used/);
  }, 60_000);
});
