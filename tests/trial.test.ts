// Self-service sign-up: 14-day free trial, enforced at the session layer. Also pins the review fix
// that an upload or task cannot be attached to a case outside the user's organisation or student.
import { beforeEach, describe, expect, it } from "vitest";
import { TRIAL_DAYS, trialEndsAt, trialInfo } from "@/domain/trial";
import type { Organization } from "@/domain/types";
import { actorFromToken, type Actor } from "@/server/auth/session";
import { signPayload } from "@/server/crypto";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { SignupSchema } from "@/server/schemas";
import { seedDemo } from "@/server/seed/seed";
import { uploadDocument } from "@/server/services/documents";
import { createOrganization } from "@/server/services/orgs";
import { createManualTask } from "@/server/services/tasks";

const NOW = new Date("2026-11-01T12:00:00Z");

describe("trial arithmetic", () => {
  it("a new trial lasts 14 days and counts down in whole days", () => {
    const org = { plan: "trial" as const, trialEndsAt: trialEndsAt(NOW) };
    expect(TRIAL_DAYS).toBe(14);
    expect(trialInfo(org, NOW)).toEqual({ onTrial: true, expired: false, daysLeft: 14 });
    expect(trialInfo(org, new Date(NOW.getTime() + 13.5 * 86_400_000)).daysLeft).toBe(1);
    expect(trialInfo(org, new Date(NOW.getTime() + 14 * 86_400_000)).expired).toBe(true);
  });

  it("active, demo and legacy organisations are never on trial; a trial with no end date counts as ended", () => {
    expect(trialInfo({ plan: "active" }, NOW).onTrial).toBe(false);
    expect(trialInfo({}, NOW).onTrial).toBe(false);
    expect(trialInfo(null, NOW).onTrial).toBe(false);
    expect(trialInfo({ plan: "trial" }, NOW).expired).toBe(true);
  });

  it("sign-up input is validated: terms accepted, real email, password of 8+ characters", () => {
    const ok = { consultancyName: "Lahore Study", name: "Ali Khan", email: " Ali@Example.com ", password: "longenough", agree: true };
    expect(SignupSchema.parse(ok).email).toBe("ali@example.com");
    expect(SignupSchema.safeParse({ ...ok, agree: undefined }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...ok, password: "short" }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
  });
});

describe("trial enforcement", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
    setRepo(repo);
  });

  it("a sign-up with a password starts a trial; the create-org script makes an active organisation", async () => {
    const t = await createOrganization(repo, { name: "Trial Co", ownerName: "Owner One", ownerEmail: "one@example.com", password: "password123" });
    expect(t.plan).toBe("trial");
    expect(trialInfo(await repo.get<Organization>("organizations", t.orgId)).daysLeft).toBe(14);
    const a = await createOrganization(repo, { name: "Paid Co", ownerName: "Owner Two", ownerEmail: "two@example.com" });
    expect((await repo.get<Organization>("organizations", a.orgId))?.plan).toBe("active");
  });

  it("when the trial ends, existing sessions stop working; the data is kept", async () => {
    const t = await createOrganization(repo, { name: "Trial Co", ownerName: "Owner One", ownerEmail: "one@example.com", password: "password123" });
    const token = signPayload({ uid: t.ownerId, exp: Date.now() + 86_400_000 });
    expect((await actorFromToken(token))?.organizationId).toBe(t.orgId);
    await repo.update<Organization>("organizations", t.orgId, { trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect(await actorFromToken(token)).toBeNull();
    expect(await repo.get("users", t.ownerId)).toBeTruthy();
  });
});

describe("case ownership on uploads and tasks", () => {
  let repo: MemoryRepo;
  const officer: Actor = { id: "us_officer", name: "Sana Riaz", email: "o@x", role: "officer", organizationId: "org_demo" };
  const outsider: Actor = { ...officer, id: "us_x", organizationId: "org_other" };
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepo(repo);
    await seedDemo(repo);
  }, 60_000);

  it("an upload cannot be attached to another student's case", async () => {
    // cs_1_lowcgpa belongs to st_hamza, not st_ayesha
    await expect(uploadDocument(repo, officer, { studentId: "st_ayesha", caseId: "cs_1_lowcgpa", docType: "cv", fileName: "cv.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4") })).rejects.toThrow(/Case/);
  });

  it("a task cannot be attached to another organisation's case", async () => {
    await expect(createManualTask(repo, outsider, { caseId: "cs_1_lowcgpa", title: "Sneaky task" })).rejects.toThrow(/Case/);
  });
});
