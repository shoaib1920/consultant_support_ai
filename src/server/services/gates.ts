// Server-side gate enforcement. Every stage change and every irreversible action goes through here.
// Blocked attempts are recorded (gateEvents + audit) so the dashboard can show money protected.

import { ACTION_LABELS } from "@/domain/countries";
import { compareNames } from "@/domain/consistency";
import { convert } from "@/domain/funds";
import { GateError, IRREVERSIBLE_TRANSITIONS, assertTransition, needsOverride, nextStage, preflightBlockers, transitionBlockers } from "@/domain/gates";
import { RuleContext } from "@/domain/rules";
import type { Approval, Case, Currency, GateEvent, IrreversibleAction, Payment, PaymentType, PreflightSnapshot, RiskAcknowledgment, Stage, Student, User } from "@/domain/types";
import { APPROVER_ROLES } from "@/domain/types";
import { AuthError } from "../auth/rbac";
import { type Actor, assertCan } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import { audit } from "./audit";
import { type CaseBundle, NotFoundError, gateContext, loadCaseBundle } from "./bundle";
import { recomputeEligibility } from "./eligibility";
import { notifyUsers, usersWithRoles } from "./notify";
import { syncTasks } from "./tasks";

export interface PaymentRequest {
  type: PaymentType;
  amount: number;
  currency: Currency;
  refundable: boolean;
  payee?: string;
}

function toPKR(b: CaseBundle, amount: number, currency: Currency): number {
  const ctx = new RuleContext(b.rules, { country: b.kase.country, level: b.kase.level, intake: b.kase.intake });
  return Math.round(convert(amount, currency, "PKR", ctx)?.amount ?? 0);
}

async function recordGateEvent(tx: Repo, actor: Actor, e: Omit<GateEvent, "id" | "organizationId" | "createdAt" | "updatedAt" | "by" | "byName">) {
  const now = nowISO();
  const ev: GateEvent = { id: newId("ge_"), organizationId: actor.organizationId, createdAt: now, updatedAt: now, by: actor.id, byName: actor.name, ...e };
  await tx.set("gateEvents", ev.id, ev);
  return ev;
}

function snapshotOf(b: CaseBundle): PreflightSnapshot {
  const e = b.eligibility!;
  return {
    light: e.light,
    score: e.score,
    eligibilityId: e.id,
    openWarnings: e.reasons.filter((r) => r.severity !== "info").map((r) => r.title),
    criticalFlags: e.criticalFlags,
    ruleStatus: e.ruleIssues.map((i) => ({ key: i.key, problem: i.problem })),
  };
}

// ---------------- plain transitions ----------------

export async function transitionCase(repo: Repo, actor: Actor, caseId: string, to: Stage, extra: { offer?: Case["offer"]; decision?: Case["decision"] } = {}): Promise<Case> {
  assertCan(actor, "case.transition");
  if (IRREVERSIBLE_TRANSITIONS[to]) {
    // Never allowed directly — even if the UI is bypassed. Record the attempt.
    await repo.transaction(async (tx) => {
      const c = await tx.get<Case>("cases", caseId);
      if (!c || c.organizationId !== actor.organizationId) throw new NotFoundError("Case");
      await recordGateEvent(tx, actor, { caseId, type: "blocked", fromStage: c.stage, toStage: to, blockers: ["Irreversible transition attempted without pre-flight."] });
      await audit(tx, actor, { action: "gate.blocked", entity: "cases", entityId: caseId, caseId, after: { to, reason: "direct irreversible transition" } });
    });
    throw new GateError(`"${to}" can only be reached through the pre-flight screen.`, [`${ACTION_LABELS[IRREVERSIBLE_TRANSITIONS[to]!]} requires pre-flight with Officer + Manager confirmation.`]);
  }
  await recomputeEligibility(repo, actor, caseId);
  const res = await repo.transaction(async (tx) => {
    const b = await loadCaseBundle(tx, actor.organizationId, caseId);
    const opts = { actorId: actor.id, actorRole: actor.role, offer: extra.offer, decision: extra.decision };
    const blockers = transitionBlockers(gateContext(b), to, opts);
    if (blockers.length) {
      await recordGateEvent(tx, actor, { caseId, type: "blocked", fromStage: b.kase.stage, toStage: to, blockers });
      await audit(tx, actor, { action: "gate.blocked", entity: "cases", entityId: caseId, caseId, after: { to, blockers } });
      return { blockers };
    }
    const now = nowISO();
    const patch: Partial<Case> = {
      stage: to,
      stageHistory: [...b.kase.stageHistory, { stage: to, at: now, by: actor.name }],
      updatedAt: now,
      ...(extra.offer ? { offer: extra.offer } : {}),
      ...(extra.decision ? { decision: extra.decision } : {}),
    };
    await tx.update<Case>("cases", caseId, patch);
    await recordGateEvent(tx, actor, { caseId, type: "transition", fromStage: b.kase.stage, toStage: to });
    await audit(tx, actor, { action: "case.transition", entity: "cases", entityId: caseId, caseId, before: { stage: b.kase.stage }, after: { stage: to } });
    return { kase: { ...b.kase, ...patch } as Case };
  });
  if ("blockers" in res && res.blockers) throw new GateError(`Gate blocked: cannot move to "${to}"`, res.blockers);
  await syncTasks(repo, actor, caseId);
  return (res as { kase: Case }).kase;
}

// ---------------- pre-flight (irreversible actions) ----------------

export async function startPreflight(repo: Repo, actor: Actor, caseId: string, action: IrreversibleAction, payment: PaymentRequest | undefined, confirmations: { reviewedWarnings: boolean; checkedAmount: boolean }): Promise<Approval> {
  assertCan(actor, "preflight.request");
  if (!confirmations.reviewedWarnings || !confirmations.checkedAmount) throw new GateError("Pre-flight confirmations not ticked", ["Tick both confirmations: you reviewed every open warning and checked the amount."]);
  if (action === "pay_fee" && !payment) throw new GateError("Payment details required", ["Enter the payment type, amount and refundable status."]);
  await recomputeEligibility(repo, actor, caseId);
  const res = await repo.transaction(async (tx) => {
    const b = await loadCaseBundle(tx, actor.organizationId, caseId);
    const amountPKR = payment ? toPKR(b, payment.amount, payment.currency) : 0;
    const blockers = preflightBlockers(gateContext(b), action);
    if (blockers.length) {
      await recordGateEvent(tx, actor, {
        caseId,
        type: "blocked",
        fromStage: b.kase.stage,
        action,
        blockers,
        amountAtRisk: payment && !payment.refundable ? { amount: payment.amount, currency: payment.currency, amountPKR } : undefined,
      });
      await audit(tx, actor, { action: "preflight.blocked", entity: "cases", entityId: caseId, caseId, after: { action, blockers, payment } });
      return { blockers };
    }
    for (const old of b.approvals.filter((a) => a.kind === "preflight" && a.status === "pending_manager" && a.action === action)) {
      await tx.update<Approval>("approvals", old.id, { status: "superseded", updatedAt: nowISO() });
    }
    const now = nowISO();
    const ap: Approval = {
      id: newId("ap_"),
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      caseId,
      kind: "preflight",
      action,
      payment: payment ? { ...payment, amountPKR } : undefined,
      snapshot: snapshotOf(b),
      eligibilityId: b.eligibility!.id,
      eligibilityFingerprint: b.eligibility!.fingerprint,
      requestedBy: actor.id,
      requestedByName: actor.name,
      officerConfirmedBy: actor.id,
      officerConfirmedAt: now,
      status: "pending_manager",
    };
    await tx.set("approvals", ap.id, ap);
    await recordGateEvent(tx, actor, { caseId, type: "preflight_started", action, fromStage: b.kase.stage, amountAtRisk: ap.payment && !ap.payment.refundable ? { amount: ap.payment.amount, currency: ap.payment.currency, amountPKR } : undefined });
    await audit(tx, actor, { action: "preflight.started", entity: "approvals", entityId: ap.id, caseId, after: ap });
    const managers = await usersWithRoles(tx, actor.organizationId, APPROVER_ROLES);
    await notifyUsers(tx, actor.organizationId, managers.filter((m) => m.id !== actor.id).map((m) => m.id), {
      title: `Pre-flight awaiting your confirmation: ${ACTION_LABELS[action]}`,
      body: `${b.kase.studentName} — ${b.kase.universityName}. ${ap.payment ? `${ap.payment.refundable ? "Refundable" : "NON-REFUNDABLE"} ${ap.payment.amount} ${ap.payment.currency}.` : ""}`,
      link: `/cases/${caseId}/gates`,
      kind: "warning",
      caseId,
    });
    return { ap };
  });
  if ("blockers" in res && res.blockers) throw new GateError(`Pre-flight blocked: ${ACTION_LABELS[action]}`, res.blockers);
  return (res as { ap: Approval }).ap;
}

export async function confirmPreflight(repo: Repo, actor: Actor, approvalId: string, confirmations: { understandsNonRefundable: boolean }): Promise<Approval> {
  assertCan(actor, "preflight.confirm_manager");
  const pre = await repo.get<Approval>("approvals", approvalId);
  if (!pre || pre.organizationId !== actor.organizationId || pre.kind !== "preflight") throw new NotFoundError("Pre-flight");
  if (pre.status !== "pending_manager") throw new GateError("Pre-flight is not awaiting confirmation", [`Status is ${pre.status}.`]);
  if (pre.officerConfirmedBy === actor.id) throw new GateError("Two-person rule", ["The manager confirmation must come from a different person than the officer who started the pre-flight."]);
  if (pre.payment && !pre.payment.refundable && !confirmations.understandsNonRefundable) throw new GateError("Confirmation required", ["Confirm that you understand the money is non-refundable."]);

  // Re-assess at execution time: the decision is based on CURRENT data, not the snapshot.
  await recomputeEligibility(repo, actor, pre.caseId);
  const res = await repo.transaction(async (tx) => {
    // re-check inside the transaction: two simultaneous confirmations must not both execute
    const current = await tx.get<Approval>("approvals", approvalId);
    if (!current || current.status !== "pending_manager") throw new GateError("Pre-flight is no longer awaiting confirmation", [`Status is ${current?.status ?? "missing"}. Refresh the page.`]);
    const b = await loadCaseBundle(tx, actor.organizationId, pre.caseId);
    const now = nowISO();
    const approved: Approval = { ...current, managerConfirmedBy: actor.id, managerConfirmedAt: now, status: "approved", updatedAt: now };
    const ctx = gateContext(b);
    const target = Object.entries(IRREVERSIBLE_TRANSITIONS).find(([, a]) => a === pre.action)![0] as Stage;
    const moving = nextStage(b.kase.stage) === target;
    let blockers: string[];
    if (moving) blockers = transitionBlockers(ctx, target, { actorId: actor.id, actorRole: actor.role, preflight: approved });
    else {
      blockers = preflightBlockers(ctx, pre.action!);
      if (approved.eligibilityFingerprint !== b.eligibility?.fingerprint) blockers.push("Assessment changed after pre-flight was started — start a new pre-flight.");
    }
    if (blockers.length) {
      await recordGateEvent(tx, actor, { caseId: pre.caseId, type: "blocked", action: pre.action, fromStage: b.kase.stage, blockers, amountAtRisk: pre.payment && !pre.payment.refundable ? { amount: pre.payment.amount, currency: pre.payment.currency, amountPKR: pre.payment.amountPKR } : undefined });
      await audit(tx, actor, { action: "preflight.blocked_at_execution", entity: "approvals", entityId: pre.id, caseId: pre.caseId, after: { blockers } });
      return { blockers };
    }
    if (moving) assertTransition(ctx, target, { actorId: actor.id, actorRole: actor.role, preflight: approved }); // belt and braces
    const executed: Approval = { ...approved, status: "executed", executedAt: now };
    await tx.set("approvals", executed.id, executed);
    if (pre.payment) {
      const pay: Payment = {
        id: newId("pa_"),
        organizationId: actor.organizationId,
        createdAt: now,
        updatedAt: now,
        caseId: pre.caseId,
        studentId: b.kase.studentId,
        type: pre.payment.type,
        description: pre.payment.payee,
        amount: pre.payment.amount,
        currency: pre.payment.currency,
        amountPKR: pre.payment.amountPKR,
        refundable: pre.payment.refundable,
        status: "authorized",
        authorizedBy: [pre.officerConfirmedBy!, actor.id],
        authorizedAt: now,
        approvalId: pre.id,
        recordedBy: actor.id,
      };
      await tx.set("payments", pay.id, pay);
      await audit(tx, actor, { action: "payment.authorized", entity: "payments", entityId: pay.id, caseId: pre.caseId, after: pay });
    }
    if (moving) {
      await tx.update<Case>("cases", pre.caseId, { stage: target, stageHistory: [...b.kase.stageHistory, { stage: target, at: now, by: actor.name }], updatedAt: now });
      await audit(tx, actor, { action: "case.transition", entity: "cases", entityId: pre.caseId, caseId: pre.caseId, before: { stage: b.kase.stage }, after: { stage: target, via: pre.id } });
    }
    await recordGateEvent(tx, actor, { caseId: pre.caseId, type: "preflight_executed", action: pre.action, fromStage: b.kase.stage, toStage: moving ? target : undefined });
    await audit(tx, actor, { action: "preflight.executed", entity: "approvals", entityId: pre.id, caseId: pre.caseId, before: { status: pre.status }, after: { status: "executed", managerConfirmedBy: actor.id } });
    await notifyUsers(tx, actor.organizationId, [pre.officerConfirmedBy!], { title: `Pre-flight confirmed: ${ACTION_LABELS[pre.action!]}`, body: `${b.kase.studentName} — confirmed by ${actor.name}.`, link: `/cases/${pre.caseId}/gates`, kind: "info", caseId: pre.caseId });
    return { executed };
  });
  if ("blockers" in res && res.blockers) throw new GateError("Blocked at execution — nothing was paid or submitted.", res.blockers);
  await syncTasks(repo, actor, pre.caseId);
  return (res as { executed: Approval }).executed;
}

export async function cancelPreflight(repo: Repo, actor: Actor, approvalId: string, reason: string) {
  assertCan(actor, "preflight.request");
  await repo.transaction(async (tx) => {
    const p = await tx.get<Approval>("approvals", approvalId);
    if (!p || p.organizationId !== actor.organizationId) throw new NotFoundError("Pre-flight");
    if (p.status !== "pending_manager") throw new GateError("Cannot cancel", [`Status is ${p.status}.`]);
    await tx.update<Approval>("approvals", approvalId, { status: "cancelled", reason, updatedAt: nowISO() });
    await recordGateEvent(tx, actor, { caseId: p.caseId, type: "preflight_cancelled", action: p.action, note: reason });
    await audit(tx, actor, { action: "preflight.cancelled", entity: "approvals", entityId: approvalId, caseId: p.caseId, after: { reason } });
  });
}

// ---------------- manager override + student acknowledgment ----------------

export function plainLanguageRisks(b: CaseBundle): string[] {
  const e = b.eligibility!;
  return e.reasons
    .filter((r) => r.hardFail || r.severity === "critical")
    .slice(0, 8)
    .map((r) => `${r.title}. ${r.fix ? `What this means: ${r.fix}` : ""}`.trim());
}

export async function grantOverride(repo: Repo, actor: Actor, caseId: string, reason: string): Promise<{ override: Approval; ack: RiskAcknowledgment }> {
  assertCan(actor, "override.grant");
  if (reason.trim().length < 30) throw new GateError("Reason too short", ["Write a specific reason (at least 30 characters) explaining why proceeding is justified."]);
  await recomputeEligibility(repo, actor, caseId);
  return repo.transaction(async (tx) => {
    const b = await loadCaseBundle(tx, actor.organizationId, caseId);
    const e = b.eligibility;
    if (!e) throw new GateError("No assessment", ["Run the eligibility assessment first."]);
    if (!needsOverride(e)) throw new GateError("Override not needed", ["This case is not RED or AMBER-with-critical-flags."]);
    if (e.ruleIssues.length) throw new GateError("Rules unverified", ["Overrides cannot bypass unverified, stale or conflicting rules. Verify the rules first."]);
    const now = nowISO();
    for (const old of b.approvals.filter((a) => a.kind === "override" && a.status === "approved")) await tx.update<Approval>("approvals", old.id, { status: "superseded", updatedAt: now });
    for (const old of b.riskAcks.filter((r) => r.status === "pending")) await tx.update<RiskAcknowledgment>("riskAcknowledgments", old.id, { status: "void", updatedAt: now });
    const override: Approval = {
      id: newId("ap_"),
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      caseId,
      kind: "override",
      reason: reason.trim(),
      eligibilityId: e.id,
      eligibilityFingerprint: e.fingerprint,
      snapshot: snapshotOf(b),
      requestedBy: actor.id,
      requestedByName: actor.name,
      managerConfirmedBy: actor.id,
      managerConfirmedAt: now,
      status: "approved",
    };
    const ack: RiskAcknowledgment = {
      id: newId("ra_"),
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      caseId,
      studentId: b.kase.studentId,
      eligibilityId: e.id,
      eligibilityFingerprint: e.fingerprint,
      overrideApprovalId: override.id,
      risks: plainLanguageRisks(b),
      status: "pending",
    };
    await tx.set("approvals", override.id, override);
    await tx.set("riskAcknowledgments", ack.id, ack);
    await recordGateEvent(tx, actor, { caseId, type: "override", fromStage: b.kase.stage, note: reason.trim() });
    await audit(tx, actor, { action: "override.granted", entity: "approvals", entityId: override.id, caseId, after: { reason: override.reason, light: e.light, fingerprint: e.fingerprint } });
    if (b.student.portalUserId) {
      await notifyUsers(tx, actor.organizationId, [b.student.portalUserId], { title: "Please review and sign a risk acknowledgment", body: "Your consultant needs your signature before continuing.", link: `/portal/sign/${ack.id}`, kind: "warning", caseId });
    }
    return { override, ack };
  });
}

export async function signRiskAcknowledgment(repo: Repo, actor: Actor, ackId: string, input: { signedName: string; signatureDataUrl: string; agree: boolean; userAgent?: string }): Promise<RiskAcknowledgment> {
  if (actor.role !== "student") throw new AuthError("Only the student can sign their own risk acknowledgment.");
  if (!input.agree) throw new GateError("Agreement required", ["Tick the box to confirm you have read and understood the risks."]);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(input.signatureDataUrl) || input.signatureDataUrl.length > 400_000) throw new GateError("Signature required", ["Draw your signature in the box."]);
  return repo.transaction(async (tx) => {
    const ack = await tx.get<RiskAcknowledgment>("riskAcknowledgments", ackId);
    if (!ack || ack.organizationId !== actor.organizationId || ack.studentId !== actor.studentId) throw new NotFoundError("Acknowledgment");
    if (ack.status !== "pending") throw new GateError("Not pending", [`This acknowledgment is ${ack.status}.`]);
    const student = await tx.get<Student>("students", ack.studentId);
    if (!student || compareNames(student.personal.fullName, input.signedName) === "mismatch") throw new GateError("Name does not match", ["Type your full name exactly as on your passport."]);
    const now = nowISO();
    const signed: RiskAcknowledgment = { ...ack, status: "signed", signedName: input.signedName.trim(), signatureDataUrl: input.signatureDataUrl, signedAt: now, signedByUserId: actor.id, userAgent: input.userAgent?.slice(0, 300), updatedAt: now };
    await tx.set("riskAcknowledgments", ackId, signed);
    await audit(tx, actor, { action: "risk_ack.signed", entity: "riskAcknowledgments", entityId: ackId, caseId: ack.caseId, after: { signedName: signed.signedName, signedAt: now, fingerprint: ack.eligibilityFingerprint } });
    const c = await tx.get<Case>("cases", ack.caseId);
    const staff = await tx.list<User>("users", [["organizationId", "==", actor.organizationId]]);
    await notifyUsers(tx, actor.organizationId, staff.filter((u) => u.role !== "student" && (u.id === c?.assignedOfficerId || APPROVER_ROLES.includes(u.role))).map((u) => u.id), { title: "Student signed risk acknowledgment", body: `${student.personal.fullName} signed.`, link: `/cases/${ack.caseId}/gates`, kind: "info", caseId: ack.caseId });
    return signed;
  });
}
