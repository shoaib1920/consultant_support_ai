// Onboarding a real consultancy: organisation, first owner, and its own copy of the rules table.

import { trialEndsAt } from "@/domain/trial";
import type { Organization, Role, Rule, User } from "@/domain/types";
import { firebaseConfigured, newId, nowISO, type Repo } from "../db";
import { materialiseRules } from "../seed/rules.seed";
import { DEMO_ORG } from "../seed/constants";
import { audit } from "./audit";
import { ValidationError } from "./documents";

const SYSTEM = (organizationId: string) => ({ id: "system" as const, name: "System" as const, role: "system" as const, organizationId });

/**
 * Creates (or reuses) a Firebase Auth account for this email and returns its uid and a password-setup link.
 * Refuses if the email already belongs to a user of a different organisation.
 */
export async function provisionAuthUser(repo: Repo, input: { email: string; name: string; organizationId: string; role: Role; password?: string }): Promise<{ uid: string; setupLink?: string }> {
  // demo users and local mock mode never touch Firebase Auth (and never claim real emails)
  if (!firebaseConfigured() || input.organizationId === DEMO_ORG) return { uid: newId("us_") };
  const { getAuth } = await import("firebase-admin/auth");
  const { getAdminApp } = await import("../firebase-admin");
  const auth = getAuth(getAdminApp());
  const email = input.email.trim().toLowerCase();
  if (input.password) {
    // self-service sign-up: the person chose their own password, so never touch an existing login
    try {
      await auth.getUserByEmail(email);
      throw new ValidationError("An account with this email already exists. Sign in instead, or use “Forgot password?”.");
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
    const uid = (await auth.createUser({ email, password: input.password, displayName: input.name })).uid;
    await auth.setCustomUserClaims(uid, { orgId: input.organizationId, role: input.role });
    return { uid };
  }
  // Never reuse an account that already belongs to someone: that would hand out their password-reset
  // link and overwrite their role. A login with no VisaGuard user (e.g. someone pre-registered the email)
  // is deleted and recreated, so whoever made it loses access.
  try {
    const found = await auth.getUserByEmail(email);
    if (await repo.get<User>("users", found.uid)) throw new ValidationError(`${email} already has a VisaGuard account. Use a different email.`);
    await auth.deleteUser(found.uid);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }
  const uid = (await auth.createUser({ email, displayName: input.name })).uid;
  await auth.setCustomUserClaims(uid, { orgId: input.organizationId, role: input.role });
  return { uid, setupLink: await auth.generatePasswordResetLink(email) };
}

async function removeAuthUser(uid: string) {
  if (!firebaseConfigured()) return;
  try {
    const { getAuth } = await import("firebase-admin/auth");
    const { getAdminApp } = await import("../firebase-admin");
    await getAuth(getAdminApp()).deleteUser(uid);
  } catch (e) {
    console.error("could not remove the login of a failed sign-up", uid, e);
  }
}

export function orgIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "org";
  return `org_${slug}_${newId("").slice(-6)}`;
}

/** Rule ids are document ids, so each organisation gets its own prefixed copy; seed values start Unverified. */
export function rulesForNewOrg(organizationId: string): Rule[] {
  return materialiseRules(organizationId, "").map((r) => ({
    ...r,
    id: `${organizationId}__${r.key}__${r.country}__${r.level}__${r.intake}`.replace(/[^A-Za-z0-9_.-]/g, "-"),
    status: "Unverified" as const,
    lastVerifiedAt: undefined,
    verifiedBy: undefined,
    notes: [r.notes, "Starting value — check against the official source and mark verified."].filter(Boolean).join(" "),
  }));
}

/**
 * Creates an organisation, its owner and its rules table.
 * With `password` (self-service sign-up) the organisation starts a free trial; without it (create-org script) it is active.
 */
export async function createOrganization(repo: Repo, input: { name: string; ownerName: string; ownerEmail: string; password?: string }) {
  const now = nowISO();
  const orgId = orgIdFromName(input.name);
  const owner = await provisionAuthUser(repo, { email: input.ownerEmail, name: input.ownerName, organizationId: orgId, role: "owner", password: input.password });
  const plan = input.password ? { plan: "trial" as const, trialEndsAt: trialEndsAt(new Date(now)) } : { plan: "active" as const };
  const org: Organization = { id: orgId, name: input.name, createdAt: now, updatedAt: now, demo: false, defaultCurrency: "PKR", ...plan };
  const rules = rulesForNewOrg(orgId);
  try {
    await repo.set("organizations", orgId, { ...org, organizationId: orgId });
    await repo.set<User>("users", owner.uid, { id: owner.uid, organizationId: orgId, createdAt: now, updatedAt: now, name: input.ownerName, email: input.ownerEmail.trim().toLowerCase(), role: "owner", active: true });
    // in parallel batches: one round trip per rule in sequence is slow enough to time out a web request
    for (let i = 0; i < rules.length; i += 20) await Promise.all(rules.slice(i, i + 20).map((r) => repo.set("rules", r.id, r)));
    await repo.transaction((tx) => audit(tx, SYSTEM(orgId), { action: "organization.created", entity: "organizations", entityId: orgId, after: { name: input.name, owner: input.ownerEmail, rules: rules.length, ...plan } }));
  } catch (e) {
    // a half-made sign-up must not leave its login behind, or every retry with that email says "already exists"
    await removeAuthUser(owner.uid);
    await repo.delete("users", owner.uid).catch(() => undefined);
    await repo.delete("organizations", orgId).catch(() => undefined);
    throw e;
  }
  return { orgId, ownerId: owner.uid, setupLink: owner.setupLink, rules: rules.length, ...plan };
}
