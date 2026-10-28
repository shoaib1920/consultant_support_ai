# How the gates work

VisaGuard exists because an officer once paid a non-refundable fee for a student whose CGPA was below the programme minimum. The gates make that class of mistake structurally impossible.

## 1. One state machine, enforced on the server

```
Lead → Profile Complete → Docs Verified → Eligibility Passed → Manager Approved
     → Payment Authorized* → Submitted* → Offer/Admission → Visa Filed* → Decision → Pre-departure
                                                    (* = irreversible step)
```

- Stages advance **one at a time, in order** (`src/domain/gates.ts → transitionBlockers`).
- Every stage change, from any entry point, goes through `services/gates.ts`. The entry points are the UI server actions, `POST /api/cases/:id/transition` and the Cloud Function `transitionCaseFn`. Each change runs inside a transaction that re-reads the case and **re-runs the eligibility engine first**.
- `firestore.rules` denies every client write to `cases.stage`, `light`, `score`, `dataVersion`, and to the `approvals`, `payments`, `gateEvents`, `eligibilityResults`, `riskAcknowledgments` and `auditLog` collections. A browser calling Firestore directly cannot move a case or create a payment.

| Into stage | Requires |
|---|---|
| Profile Complete | completeness ≥ 90 % and recorded consent |
| Docs Verified | every document needed before the fee is uploaded **and verified by staff**; no unresolved critical flags |
| Eligibility Passed / Manager Approved | a fresh assessment that is GREEN, or RED / AMBER-with-critical-flags **plus** a manager override **plus** the student's signed acknowledgment. Never allowed while any rule it uses is Unverified, Conflicting or Stale. Manager Approved also needs a manager or owner. |
| Payment Authorized / Submitted / Visa Filed | **only** through an executed pre-flight (below) |

## 2. Pre-flight (irreversible actions)

1. The officer opens **Gates & pre-flight** and sees:
   - the current light and score
   - every open warning
   - rule verification status
   - the amount, currency and refundable yes/no
2. The officer ticks two confirmations and the server records the request (`approvals`, status `pending_manager`). If gates fail, the attempt is refused and logged with the **money at risk**; this feeds the "money protected" metric.
3. A **different** person with the Manager or Owner role confirms. A banner reads "Money at risk: PKR X / EUR Y NON-REFUNDABLE".
4. At confirmation the server **re-assesses from current data**. If anything changed (fingerprint mismatch, new flag, rule went stale), nothing executes.
5. On success, in one transaction, the server:
   - executes the approval
   - writes the payment ledger entry (authorised by officer + manager)
   - advances the stage
   - writes the gate event, audit entries and notifications

Non-refundable payments cannot be recorded any other way (`recordRefundablePayment` rejects them; so does `POST /api/cases/:id/payments`).

## 3. Overrides and risk acknowledgments

- An override is needed only for RED, or AMBER with critical flags.
- It needs a manager's **written reason** (at least 30 characters). It is bound to the assessment **fingerprint**, a hash of the light, the non-info findings and the rule issues.
- Granting an override creates a plain-language **risk acknowledgment**. The student signs it in the portal with their typed passport name and a drawn signature; the server stores the timestamp and user agent.
- If the assessment changes materially, both the override and the acknowledgment stop applying automatically.
- Overrides **cannot bypass unverified, stale or conflicting rules**. A manager must verify the rule first (one click on **Rules**, logged in the changelog).

## 4. AI recommends, humans decide

- The AI (Claude, or the mock) **extracts** document fields and **explains** results.
- It never sets a light, verifies a document or executes an action.
- Every AI output records its model and prompt version in the audit log.
