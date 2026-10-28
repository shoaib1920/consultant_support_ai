// Firebase Cloud Functions. They wrap the SAME services the Next.js server uses, so gate logic exists
// in exactly one place (src/domain/gates.ts) and is enforced on every write path.
// Firestore rules deny all client writes to gated collections; these callables are the only
// client-reachable way (besides the Next.js server) to change a case stage or authorise money.

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { GateError } from "../../src/domain/gates";
import type { Case, IrreversibleAction, Stage, User } from "../../src/domain/types";
import { STAGES } from "../../src/domain/types";
import { AuthError } from "../../src/server/auth/rbac";
import type { Actor } from "../../src/server/auth/session";
import { setRepo } from "../../src/server/db";
import { FirestoreRepo } from "../../src/server/db/firestore";
import { recomputeEligibility } from "../../src/server/services/eligibility";
import { confirmPreflight, grantOverride, signRiskAcknowledgment, startPreflight, transitionCase } from "../../src/server/services/gates";
import { syncTasks } from "../../src/server/services/tasks";

initializeApp();
const repo = new FirestoreRepo(getFirestore());
setRepo(repo);

async function actorOf(req: CallableRequest): Promise<Actor> {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const u = await repo.get<User>("users", req.auth.uid);
  if (!u || !u.active) throw new HttpsError("permission-denied", "User not active.");
  return { id: u.id, name: u.name, email: u.email, role: u.role, organizationId: u.organizationId, studentId: u.studentId };
}

function wrap<T>(fn: (req: CallableRequest) => Promise<T>) {
  return onCall({ enforceAppCheck: false, maxInstances: 20 }, async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof GateError) throw new HttpsError("failed-precondition", e.message, { blockers: e.blockers });
      if (e instanceof AuthError) throw new HttpsError("permission-denied", e.message);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", "Action failed; nothing irreversible was performed.");
    }
  });
}

const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v) throw new HttpsError("invalid-argument", `${name} required`);
  return v;
};

export const transitionCaseFn = wrap(async (req) => {
  const to = str(req.data?.to, "to") as Stage;
  if (!STAGES.includes(to)) throw new HttpsError("invalid-argument", "Unknown stage");
  const c = await transitionCase(repo, await actorOf(req), str(req.data?.caseId, "caseId"), to, { offer: req.data?.offer, decision: req.data?.decision });
  return { stage: c.stage };
});

export const startPreflightFn = wrap(async (req) => {
  const action = str(req.data?.action, "action") as IrreversibleAction;
  const ap = await startPreflight(repo, await actorOf(req), str(req.data?.caseId, "caseId"), action, req.data?.payment, { reviewedWarnings: !!req.data?.reviewedWarnings, checkedAmount: !!req.data?.checkedAmount });
  return { approvalId: ap.id };
});

export const confirmPreflightFn = wrap(async (req) => {
  const ap = await confirmPreflight(repo, await actorOf(req), str(req.data?.approvalId, "approvalId"), { understandsNonRefundable: !!req.data?.understandsNonRefundable });
  return { status: ap.status };
});

export const grantOverrideFn = wrap(async (req) => {
  const r = await grantOverride(repo, await actorOf(req), str(req.data?.caseId, "caseId"), str(req.data?.reason, "reason"));
  return { overrideId: r.override.id, ackId: r.ack.id };
});

export const signRiskAcknowledgmentFn = wrap(async (req) => {
  const r = await signRiskAcknowledgment(repo, await actorOf(req), str(req.data?.ackId, "ackId"), { signedName: str(req.data?.signedName, "signedName"), signatureDataUrl: str(req.data?.signatureDataUrl, "signatureDataUrl"), agree: !!req.data?.agree });
  return { status: r.status };
});

/** Keep custom claims (used by firestore.rules) in sync with the users collection. */
export const syncUserClaims = onDocumentWritten("users/{uid}", async (event) => {
  const after = event.data?.after.data() as User | undefined;
  const uid = event.params.uid;
  if (!after) {
    await getAuth().revokeRefreshTokens(uid).catch(() => undefined);
    return;
  }
  await getAuth().setCustomUserClaims(uid, { orgId: after.organizationId, role: after.active ? after.role : "disabled", studentId: after.studentId ?? null });
  if (!after.active) await getAuth().revokeRefreshTokens(uid);
});

/** Daily: re-assess every open case so rule staleness (60 days) and deadlines are reflected, and raise countdown notifications. */
export const dailySweep = onSchedule({ schedule: "every day 03:00", timeZone: "Asia/Karachi" }, async () => {
  const cases = (await repo.list<Case>("cases")).filter((c) => c.stage !== "Decision" && c.stage !== "Pre-departure");
  for (const c of cases) {
    const sys = { id: "system" as const, name: "System" as const, role: "system" as const, organizationId: c.organizationId };
    await recomputeEligibility(repo, sys, c.id);
    await syncTasks(repo, sys, c.id);
  }
});
