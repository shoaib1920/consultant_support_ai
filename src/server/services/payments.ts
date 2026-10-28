// Payments ledger. Refundable payments can be recorded directly; NON-refundable money only
// ever enters the ledger through an executed pre-flight (see services/gates.ts).

import { convert } from "@/domain/funds";
import { GateError } from "@/domain/gates";
import { RuleContext } from "@/domain/rules";
import type { Case, Payment, Rule } from "@/domain/types";
import { type Actor, assertCan } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import { putFile } from "../storage";
import { audit } from "./audit";
import { NotFoundError } from "./bundle";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, ValidationError } from "./documents";
import type { PaymentRequest } from "./gates";

/** Fees that are never refundable in practice; they always go through pre-flight, whatever the form says. */
export const ALWAYS_NON_REFUNDABLE: ReadonlySet<string> = new Set(["application_fee", "tuition_deposit", "visa_fee", "ihs", "attestation_fee"]);

export async function recordRefundablePayment(repo: Repo, actor: Actor, caseId: string, p: PaymentRequest) {
  assertCan(actor, "payment.record");
  if (!p.refundable || ALWAYS_NON_REFUNDABLE.has(p.type)) {
    throw new GateError("Non-refundable payments require pre-flight", ["Non-refundable money can only be authorised through the pre-flight screen (Officer + Manager confirmation, gates passed)."]);
  }
  return repo.transaction(async (tx) => {
    const c = await tx.get<Case>("cases", caseId);
    if (!c || c.organizationId !== actor.organizationId) throw new NotFoundError("Case");
    const rules = await tx.list<Rule>("rules", [["organizationId", "==", actor.organizationId]]);
    const ctx = new RuleContext(rules, { country: c.country, level: c.level, intake: c.intake });
    const now = nowISO();
    const pay: Payment = {
      id: newId("pa_"),
      organizationId: actor.organizationId,
      createdAt: now,
      updatedAt: now,
      caseId,
      studentId: c.studentId,
      type: p.type,
      description: p.payee,
      amount: p.amount,
      currency: p.currency,
      amountPKR: Math.round(convert(p.amount, p.currency, "PKR", ctx)?.amount ?? 0),
      refundable: true,
      status: "authorized",
      authorizedBy: [actor.id],
      authorizedAt: now,
      recordedBy: actor.id,
    };
    await tx.set("payments", pay.id, pay);
    await audit(tx, actor, { action: "payment.recorded", entity: "payments", entityId: pay.id, caseId, after: pay });
    return pay;
  });
}

export async function setPaymentStatus(repo: Repo, actor: Actor, paymentId: string, status: Payment["status"]) {
  assertCan(actor, "payment.record");
  await repo.transaction(async (tx) => {
    const p = await tx.get<Payment>("payments", paymentId);
    if (!p || p.organizationId !== actor.organizationId) throw new NotFoundError("Payment");
    if (status === "refunded" && !p.refundable) throw new ValidationError("This payment is marked non-refundable.");
    await tx.update<Payment>("payments", paymentId, { status, updatedAt: nowISO() });
    await audit(tx, actor, { action: "payment.status", entity: "payments", entityId: paymentId, caseId: p.caseId, before: { status: p.status }, after: { status } });
  });
}

export async function attachReceipt(repo: Repo, actor: Actor, paymentId: string, file: { name: string; mimeType: string; bytes: Buffer }) {
  assertCan(actor, "payment.record");
  if (!ALLOWED_MIME.includes(file.mimeType) || file.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError("Receipt must be PDF/JPG/PNG up to 4 MB.");
  const p = await repo.get<Payment>("payments", paymentId);
  if (!p || p.organizationId !== actor.organizationId) throw new NotFoundError("Payment");
  const path = `orgs/${actor.organizationId}/receipts/${paymentId}/${file.name.replace(/[^\w.\- ]+/g, "_")}`;
  await putFile(path, file.bytes, file.mimeType);
  await repo.transaction(async (tx) => {
    await tx.update<Payment>("payments", paymentId, { receiptPath: path, status: p.status === "authorized" ? "paid" : p.status, updatedAt: nowISO() });
    await audit(tx, actor, { action: "payment.receipt", entity: "payments", entityId: paymentId, caseId: p.caseId, after: { receiptPath: path } });
  });
}
