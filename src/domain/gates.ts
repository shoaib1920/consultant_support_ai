// Approval gates: the case state machine and the preconditions for every transition.
// Pure functions; the server calls assertTransition() inside a transaction for EVERY stage
// change, so neither the UI, a direct API call nor a client-side Firestore write can skip it
// (Firestore rules deny client writes to cases.stage entirely).

import { ACTION_LABELS, isDueNow, requiredDocsFor } from "./countries";
import { PROFILE_COMPLETE_THRESHOLD } from "./completeness";
import type { Approval, Case, DocumentRecord, EligibilityResult, IrreversibleAction, RiskAcknowledgment, Role, Stage, Student } from "./types";
import { APPROVER_ROLES, STAGES } from "./types";

export class GateError extends Error {
  constructor(
    message: string,
    readonly blockers: string[],
  ) {
    super(message);
    this.name = "GateError";
  }
}

export const IRREVERSIBLE_TRANSITIONS: Partial<Record<Stage, IrreversibleAction>> = {
  "Payment Authorized": "pay_fee",
  Submitted: "submit_application",
  "Visa Filed": "file_visa",
};

export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export interface GateContext {
  kase: Case;
  student: Student;
  documents: DocumentRecord[];
  eligibility?: EligibilityResult;
  approvals: Approval[];
  riskAcks: RiskAcknowledgment[];
  completenessPercent: number;
}

export interface TransitionOptions {
  actorId: string;
  actorRole: Role;
  /** Set only by the preflight executor after Officer + Manager double confirmation. */
  preflight?: Approval;
  offer?: Case["offer"];
  decision?: Case["decision"];
}

export function needsOverride(e?: EligibilityResult): boolean {
  if (!e) return false;
  return e.light === "RED" || (e.light === "AMBER" && e.criticalFlags > 0);
}

export function eligibilityFresh(ctx: GateContext): boolean {
  return !!ctx.eligibility && ctx.eligibility.dataVersion === ctx.kase.dataVersion && ctx.eligibility.caseId === ctx.kase.id;
}

/** Override + signed acknowledgement, both bound to the CURRENT eligibility result. */
export function riskClearance(ctx: GateContext): { cleared: boolean; blockers: string[]; override?: Approval; ack?: RiskAcknowledgment } {
  const e = ctx.eligibility;
  const blockers: string[] = [];
  if (!e) return { cleared: false, blockers: ["No eligibility assessment on file — run the eligibility engine."] };
  if (!eligibilityFresh(ctx)) blockers.push("Eligibility result is out of date (case data changed since it was computed) — re-run the assessment.");
  if (e.ruleIssues.length) {
    blockers.push(`Rule needs verification: ${e.ruleIssues.map((i) => `${i.key} (${i.problem})`).join(", ")}. A manager must verify these rules — overrides cannot bypass unverified rules.`);
  }
  if (!needsOverride(e)) return { cleared: blockers.length === 0, blockers };
  const override = ctx.approvals.find((a) => a.kind === "override" && a.status === "approved" && a.eligibilityFingerprint === e.fingerprint);
  const ack = ctx.riskAcks.find((r) => r.status === "signed" && r.eligibilityFingerprint === e.fingerprint);
  if (!override) blockers.push(`Status is ${e.light}${e.light === "AMBER" ? ` with ${e.criticalFlags} critical flag(s)` : ""}: a Manager override with a written reason is required.`);
  if (!ack) blockers.push("The student has not signed the risk acknowledgment for the current assessment.");
  return { cleared: blockers.length === 0, blockers, override, ack };
}

export function docsBlockers(ctx: GateContext, action: IrreversibleAction): string[] {
  const out: string[] = [];
  for (const req of requiredDocsFor(ctx.kase.country, ctx.kase.level)) {
    if (req.optional || !isDueNow(req.neededBefore, ctx.kase.stage, action)) continue;
    const docs = ctx.documents.filter((d) => d.docType === req.docType && d.reviewStatus !== "rejected");
    if (!docs.length) out.push(`Missing document: ${req.label}`);
    else if (!docs.some((d) => d.reviewStatus === "verified")) out.push(`Not verified by staff: ${req.label}`);
  }
  for (const d of ctx.documents) {
    const open = d.flags.filter((f) => f.severity === "critical" && !f.resolved);
    if (open.length) out.push(`Unresolved critical flag on ${d.fileName}: ${open[0].code}`);
  }
  return out;
}

/** Returns every reason the transition cannot happen (empty = allowed). */
export function transitionBlockers(ctx: GateContext, to: Stage, opts: TransitionOptions): string[] {
  const from = ctx.kase.stage;
  const b: string[] = [];
  if (nextStage(from) !== to) {
    return [`Invalid transition ${from} → ${to}. Stages must be completed in order.`];
  }
  if (opts.actorRole === "student") return ["Students cannot change case stages."];

  const action = IRREVERSIBLE_TRANSITIONS[to];
  if (action) {
    const p = opts.preflight;
    if (!p) b.push(`"${ACTION_LABELS[action]}" is irreversible and can only run through the pre-flight screen with Officer + Manager confirmation.`);
    else {
      if (p.kind !== "preflight" || p.action !== action || p.caseId !== ctx.kase.id) b.push("Pre-flight approval does not match this action.");
      if (!p.officerConfirmedBy) b.push("Officer confirmation missing.");
      if (!p.managerConfirmedBy) b.push("Manager confirmation missing.");
      if (p.officerConfirmedBy && p.officerConfirmedBy === p.managerConfirmedBy) b.push("Officer and Manager confirmations must come from two different people.");
      if (p.status !== "approved") b.push(`Pre-flight is ${p.status}, not approved.`);
      if (ctx.eligibility && p.eligibilityFingerprint !== ctx.eligibility.fingerprint) b.push("Assessment changed after pre-flight was confirmed — start a new pre-flight.");
    }
    b.push(...riskClearance(ctx).blockers);
    b.push(...docsBlockers(ctx, action));
    return dedupe(b);
  }

  switch (to) {
    case "Profile Complete":
      if (ctx.completenessPercent < PROFILE_COMPLETE_THRESHOLD) b.push(`Profile is ${ctx.completenessPercent}% complete (needs ${PROFILE_COMPLETE_THRESHOLD}%).`);
      if (!ctx.student.consent.given) b.push("Student data-processing consent not recorded.");
      break;
    case "Docs Verified":
      b.push(...docsBlockers(ctx, "pay_fee"));
      break;
    case "Eligibility Passed":
      b.push(...riskClearance(ctx).blockers);
      break;
    case "Manager Approved":
      if (!APPROVER_ROLES.includes(opts.actorRole)) b.push("Only a Manager or Owner can approve.");
      b.push(...riskClearance(ctx).blockers);
      break;
    case "Offer/Admission":
      if (!opts.offer && !ctx.kase.offer) b.push("Record the offer/admission details (type, date, reference).");
      break;
    case "Decision":
      if (!opts.decision && !ctx.kase.decision) b.push("Record the visa decision.");
      break;
    case "Pre-departure":
      if ((opts.decision ?? ctx.kase.decision)?.outcome !== "approved") b.push("Pre-departure is only available after an approved visa decision.");
      break;
  }
  return dedupe(b);
}

export function assertTransition(ctx: GateContext, to: Stage, opts: TransitionOptions): void {
  const blockers = transitionBlockers(ctx, to, opts);
  if (blockers.length) throw new GateError(`Gate blocked: ${ctx.kase.stage} → ${to}`, blockers);
}

/** Blockers to START a pre-flight for an irreversible action (before confirmations exist). */
export function preflightBlockers(ctx: GateContext, action: IrreversibleAction): string[] {
  const target = (Object.entries(IRREVERSIBLE_TRANSITIONS).find(([, a]) => a === action)?.[0] ?? "") as Stage;
  const b: string[] = [];
  // Non-refundable payments are allowed at any stage from "Manager Approved" onward (tuition deposit,
  // visa fee, IHS ...), always through pre-flight. Submit/File must be the exact next stage.
  const payLater = action === "pay_fee" && STAGES.indexOf(ctx.kase.stage) >= STAGES.indexOf("Manager Approved") && ctx.kase.stage !== "Decision" && ctx.kase.stage !== "Pre-departure";
  if (!payLater && nextStage(ctx.kase.stage) !== target) b.push(`"${ACTION_LABELS[action]}" is only available from stage "${STAGES[STAGES.indexOf(target) - 1]}" (case is at "${ctx.kase.stage}").`);
  b.push(...riskClearance(ctx).blockers);
  b.push(...docsBlockers(ctx, action));
  return dedupe(b);
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}
