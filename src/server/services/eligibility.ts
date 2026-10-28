// Runs the deterministic engine, persists the result (idempotent by fingerprint), optionally adds
// an AI narrative (rate-limited, audited with model + prompt version).

import { COUNTRIES } from "@/domain/countries";
import { computeEligibility } from "@/domain/eligibility";
import { formatMoney } from "@/domain/funds";
import type { AiNarrative, Case, EligibilityResult } from "@/domain/types";
import { checkRateLimit, getAI } from "../ai";
import { type Repo, newId, nowISO } from "../db";
import { type AuditActor, audit } from "./audit";
import { loadCaseBundle } from "./bundle";

export async function recomputeEligibility(repo: Repo, actor: AuditActor, caseId: string, opts: { withAI?: boolean } = {}): Promise<EligibilityResult> {
  const b = await loadCaseBundle(repo, actor.organizationId, caseId);
  const comp = computeEligibility({
    student: b.student,
    kase: b.kase,
    rules: b.rules,
    programme: b.programme,
    documents: b.documents,
    attestations: b.attestations,
    financial: b.financial,
  });

  let ai: AiNarrative | undefined;
  if (opts.withAI) {
    checkRateLimit(`ai:${actor.id}`);
    ai = await getAI().narrate({
      result: comp,
      caseSummary: `${b.kase.studentName} → ${b.kase.universityName}, ${b.kase.programmeName} (${COUNTRIES[b.kase.country].name}), intake ${b.kase.intake}, stage ${b.kase.stage}, tuition ${formatMoney(b.kase.tuitionFee.amount, b.kase.tuitionFee.currency)}.`,
    });
  }

  return repo.transaction(async (tx) => {
    const prev = b.eligibility;
    if (prev && prev.fingerprint === comp.fingerprint && prev.dataVersion === comp.dataVersion && !ai) return prev;
    const now = nowISO();
    const result: EligibilityResult = {
      ...comp,
      id: newId("el_"),
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      ai: ai ?? (prev?.fingerprint === comp.fingerprint ? prev.ai : undefined),
    };
    await tx.set("eligibilityResults", result.id, result);
    await tx.update<Case>("cases", caseId, {
      light: result.light,
      score: result.score,
      criticalFlags: result.criticalFlags,
      ruleIssues: result.ruleIssues.length,
      latestEligibilityId: result.id,
      updatedAt: now,
    });
    await audit(tx, actor, {
      action: ai ? "eligibility.computed_with_ai" : "eligibility.computed",
      entity: "eligibilityResults",
      entityId: result.id,
      caseId,
      before: prev ? { light: prev.light, score: prev.score, fingerprint: prev.fingerprint } : undefined,
      after: { light: result.light, score: result.score, fingerprint: result.fingerprint, engine: result.engineVersion, reasons: result.reasons.length },
      ai: ai ? { model: ai.model, promptVersion: ai.promptVersion, source: ai.source } : undefined,
    });
    return result;
  });
}

/** Mark a case's inputs as changed: eligibility becomes stale until recomputed. */
export async function bumpDataVersion(tx: Repo, caseIds: string[]) {
  for (const id of caseIds) {
    const c = await tx.get<Case>("cases", id);
    if (c) await tx.update<Case>("cases", id, { dataVersion: (c.dataVersion ?? 0) + 1, updatedAt: nowISO() });
  }
}

export async function casesForStudent(repo: Repo, organizationId: string, studentId: string): Promise<Case[]> {
  return repo.list<Case>("cases", [
    ["organizationId", "==", organizationId],
    ["studentId", "==", studentId],
  ]);
}

/** Change inputs for a student's cases and recompute deterministically (no AI). */
export async function refreshStudentCases(repo: Repo, actor: AuditActor, studentId: string) {
  const cases = await casesForStudent(repo, actor.organizationId, studentId);
  await repo.transaction((tx) => bumpDataVersion(tx, cases.map((c) => c.id)));
  for (const c of cases) await recomputeEligibility(repo, actor, c.id);
}

export async function refreshCase(repo: Repo, actor: AuditActor, caseId: string) {
  await repo.transaction((tx) => bumpDataVersion(tx, [caseId]));
  return recomputeEligibility(repo, actor, caseId);
}
