import type { Case, Rule, RuleChange, RuleStatus, RuleValue } from "@/domain/types";
import { type Actor, assertCan } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import { audit } from "./audit";
import { NotFoundError } from "./bundle";
import { bumpDataVersion, recomputeEligibility } from "./eligibility";

async function logChange(tx: Repo, actor: Actor, rule: Rule, action: RuleChange["action"], before: Partial<Rule> | undefined, after: Partial<Rule>, reason?: string) {
  const now = nowISO();
  const ch: RuleChange = { id: newId("rc_"), organizationId: actor.organizationId, createdAt: now, updatedAt: now, ruleId: rule.id, ruleKey: rule.key, country: rule.country, changedBy: actor.id, changedByName: actor.name, action, before, after, reason };
  await tx.set("ruleChangelog", ch.id, ch);
  await audit(tx, actor, { action: `rule.${action}`, entity: "rules", entityId: rule.id, before, after: { ...after, reason } });
}

/** Rule changes can alter any case in that country: mark them stale and recompute deterministically. */
async function refreshAffected(repo: Repo, actor: Actor, country: Rule["country"]) {
  const cases = await repo.list<Case>("cases", [["organizationId", "==", actor.organizationId]]);
  const affected = cases.filter((c) => country === "*" || c.country === country);
  await repo.transaction((tx) => bumpDataVersion(tx, affected.map((c) => c.id)));
  for (const c of affected) await recomputeEligibility(repo, actor, c.id);
}

export async function updateRule(repo: Repo, actor: Actor, ruleId: string, input: { value: RuleValue; unit: string; label: string; sourceUrl: string; sourceNote?: string; status: RuleStatus; notes?: string; reason: string }) {
  assertCan(actor, "rules.edit");
  // Only verifiers may set Verified status; editing a value always resets to Unverified unless a verifier saves it.
  const canVerify = actor.role === "owner" || actor.role === "manager";
  const rule = await repo.transaction(async (tx) => {
    const r = await tx.get<Rule>("rules", ruleId);
    if (!r || r.organizationId !== actor.organizationId) throw new NotFoundError("Rule");
    const valueChanged = r.value !== input.value;
    const status: RuleStatus = input.status === "Verified" && !canVerify ? "Unverified" : input.status;
    const now = nowISO();
    const patch: Partial<Rule> = {
      value: input.value,
      unit: input.unit,
      label: input.label,
      sourceUrl: input.sourceUrl,
      sourceNote: input.sourceNote,
      notes: input.notes,
      status,
      ...(status === "Verified" && (valueChanged || r.status !== "Verified") ? { lastVerifiedAt: now, verifiedBy: actor.name } : {}),
      seed: valueChanged ? false : r.seed,
      updatedAt: now,
    };
    await tx.update<Rule>("rules", ruleId, patch);
    await logChange(tx, actor, r, "update", { value: r.value, status: r.status, sourceUrl: r.sourceUrl, unit: r.unit }, { value: patch.value, status: patch.status, sourceUrl: patch.sourceUrl, unit: patch.unit }, input.reason);
    return r;
  });
  await refreshAffected(repo, actor, rule.country);
}

export async function verifyRule(repo: Repo, actor: Actor, ruleId: string, note?: string) {
  assertCan(actor, "rules.verify");
  const rule = await repo.transaction(async (tx) => {
    const r = await tx.get<Rule>("rules", ruleId);
    if (!r || r.organizationId !== actor.organizationId) throw new NotFoundError("Rule");
    const now = nowISO();
    await tx.update<Rule>("rules", ruleId, { status: "Verified", lastVerifiedAt: now, verifiedBy: actor.name, updatedAt: now });
    await logChange(tx, actor, r, "verify", { status: r.status, lastVerifiedAt: r.lastVerifiedAt, verifiedBy: r.verifiedBy }, { status: "Verified", lastVerifiedAt: now, verifiedBy: actor.name }, note || `Checked against ${r.sourceUrl}`);
    return r;
  });
  await refreshAffected(repo, actor, rule.country);
}

export async function createRule(repo: Repo, actor: Actor, input: Pick<Rule, "country" | "level" | "intake" | "key" | "label" | "value" | "unit" | "sourceUrl" | "notes">) {
  assertCan(actor, "rules.edit");
  const now = nowISO();
  const r: Rule = { ...input, intake: input.intake || "*", id: newId("ru_"), organizationId: actor.organizationId, createdAt: now, updatedAt: now, status: "Unverified" };
  await repo.transaction(async (tx) => {
    const dup = (await tx.list<Rule>("rules", [["organizationId", "==", actor.organizationId], ["key", "==", r.key]])).find((x) => x.country === r.country && x.level === r.level && x.intake === r.intake);
    if (dup) throw new Error(`A rule ${r.key} already exists for this scope.`);
    await tx.set("rules", r.id, r);
    await logChange(tx, actor, r, "create", undefined, { value: r.value, status: r.status });
  });
  await refreshAffected(repo, actor, r.country);
  return r;
}
