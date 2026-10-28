# VisaGuard

Case management and refusal-risk screening for study-visa consultancies (UK, Germany, Italy, France), built for consultancies in Pakistan.

> **Nothing irreversible happens until the verification gates pass.** AI recommends and explains; a human decides. VisaGuard detects problems. It never helps create or disguise documents or funds, and it never promises approval.
>
> **Disclaimer:** this is a decision-support tool, not legal or immigration advice. Outputs depend on rules verified by your staff.

---

## Quick start (no keys needed: everything runs on mocks)

```bash
npm install
cp .env.example .env.local     # set SESSION_SECRET to a long random string
npm run dev                    # http://localhost:3000
```

- The demo organisation is **seeded automatically** on first visit.
- Choose a role on the login page.
- Reset any time with **Settings → One-click reset**, or run `npm run seed`.

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | 64 unit/integration tests (Vitest) |
| `npm run test:rules` | Firestore security-rules tests against the emulator (needs `firebase-tools` + Java) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Re-create demo data (memory store, or Firestore if configured) |

Node ≥ 20.9. **Use Node 22 for Firebase mode** (`firebase-admin` 14 requires it).

### Demo walkthrough (6 scenarios)

Sign in as **Ayesha Malik (Owner)**, then open **Cases**.

| # | Student | What you should see |
|---|---|---|
| 1 | Hamza Iqbal → UK, Northbridge MSc Data Science | **RED**: CGPA 2.45 vs minimum 3.00. The officer's £3,000 non-refundable deposit attempt was **blocked**; this is the original incident, recreated. |
| 2 | Ayesha Noor → UK, Harrowgate | **RED**: funds dip below £22,539 (PKR 8.53M) on **day 19** of the 28-day window. The Financial tab shows the dip and "Fix this". |
| 3 | Muhammad Ali Raza → Germany, TU Rheinfeld | **RED**: APS missing; the HEC → MOFA → APS chain finishes after the 15 Jan deadline. A stale rule is flagged. |
| 4 | Fatima Zahra → Italy, Valcorso | **RED**: Universitaly not validated, no DoV/CIMEA, a PKR 3.5M unexplained deposit, a name-spelling variant, and the 30 Nov deadline countdown. |
| 5 | Zainab Hussain → France, Montclar | **AMBER, "Rule needs verification"**: a clean file, but the France funds rule is *Conflicting*. As Manager, click **Mark verified** on Rules and it turns GREEN. |
| 6 | Omar Farooq → UK, Caledon | **GREEN**. Try the full pre-flight: as **Sana (Officer)**, open Gates & pre-flight and confirm a fee; then as **Bilal (Manager)**, confirm. The stage moves to Payment Authorized. |

Also available:
- **Student portal**: sign in as a student.
- **Secure intake link**: `/intake/demo-intake-link-saad-khan-2026`.
- **Override flow**: as Bilal on case 1, grant an override. Then sign in as Hamza → portal → sign. The gate opens.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes (prod) | HMAC key for session cookies and signed file URLs |
| `STORAGE_ENCRYPTION_KEY` | recommended | AES-256-GCM key for uploads in local/mock storage |
| `DEMO_MODE` | – | `true` = demo banner, demo login, auto-seed, reset. Set `false` in production. |
| `ANTHROPIC_API_KEY` | no | Enables Claude. If empty, the **mock** AI is used. |
| `ANTHROPIC_MODEL` | no | Default `claude-opus-5-5` |
| `AI_RATE_LIMIT_PER_MINUTE` | no | Per-user AI call limit (default 10) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | no | Service-account JSON on one line. Enables Firestore, Storage and Auth. |
| `NEXT_PUBLIC_FIREBASE_*` | with Firebase | Client SDK config for email/password sign-in |
| `FILE_STORAGE` | no | `firestore` (default with Firebase; uploads stored as encrypted chunks in Firestore, works on the **free Spark plan**), `firebase` (Firebase Storage, Blaze plan) or `local` (mock) |
| `VISAGUARD_DATA_DIR` | no | Location of the mock datastore and uploads (default `.data`, or `/tmp/visaguard` on Vercel) |

## MOCKS (what is simulated when keys are missing)

| Mock | Used when | Behaviour | Replace with |
|---|---|---|---|
| **Mock datastore** (`src/server/db/memory.ts`) | no `FIREBASE_SERVICE_ACCOUNT_JSON` | In-process store persisted to `.data/db.json`; serialised transactions with rollback | Firestore adapter (`db/firestore.ts`, already implemented) |
| **Mock auth** (demo login) | `DEMO_MODE=true` | HMAC-signed cookie; pick any seeded user | Firebase Auth session cookies (implemented: `issueFirebaseSession`) |
| **Mock storage** | no Firebase | Files AES-256-GCM encrypted on local disk; 5-minute HMAC-signed URLs; session + org check on download | Firebase Storage + `getSignedUrl` (implemented) |
| **Mock AI extractor** (`ai/mock.ts`) | no `ANTHROPIC_API_KEY` | Derives fields from the student profile so consistency checks run. Upload a **`.json` sidecar** (`{"fields":{...},"transactions":[...],"pagesDetected":n}`) to simulate discrepancies. Detects instruction-like text in `.txt` uploads. | Claude vision (`ai/claude.ts`) |
| **Mock AI narrator** | no key | Template explanation built from the deterministic result, labelled "Mock AI" | Claude narrative |
| **Seed rules** | always in demo | All marked "Seed - verify against official source"; pre-verified by the demo manager, except France funds (**Conflicting**), Italy repatriation (**Unverified** placeholder) and DE blocked-account monthly (**STALE**) | Your managers verify against official sources |
| **Sample programmes** | demo | 6–7 *fictional* institutions per country with realistic shapes, badged "Sample data" | Your verified programme data |
| **FX rates** | demo | Illustrative rules (`fx.GBP_PKR` etc.) | Update daily from SBP or your bank |
| **Seed documents** | demo | Generated PDFs stamped "SAMPLE DEMO FILE - NOT A REAL DOCUMENT" | Real uploads |

## Architecture

```
src/domain/        Pure business logic (no framework): rules, funds, bank (28-day), grades, consistency,
                   attestation, eligibility, matching, gates (state machine), tasks, templates
src/server/db      Repo interface → MemoryRepo (mock) | FirestoreRepo (buffered transactional writes)
src/server/auth    Sessions (mock / Firebase) + RBAC matrix (mirrored in firestore.rules)
src/server/ai      ClaudeProvider (JSON-schema output, Zod-validated, server-side fallback) | MockProvider
src/server/services  The only write paths: audit, gates, documents, financial, cases, rules, payments…
src/server/actions Server actions: auth → permission → Zod → service → revalidate
src/app            (app)/ staff UI · portal/ student UI · intake/[token] · api/ (files, PDF, REST)
functions/         Cloud Functions wrapping the same services + claims sync + daily sweep
firestore.rules    Least-privilege, multi-tenant; gated collections are server-write-only
```

Every Firestore record carries `organizationId`. The collections are organizations, users, students, cases, documents, extractedFields, attestations, rules, ruleChangelog, universities, programmes, eligibilityResults, financialAnalyses, matchResults, gateEvents, approvals, riskAcknowledgments, payments, tasks, notifications, and auditLog (+ auditHeads).

**How the gates work:** see [docs/HOW_GATES_WORK.md](docs/HOW_GATES_WORK.md).

### Security

- **RBAC** is enforced in server actions, REST routes and Cloud Functions. Firestore rules mirror it; the UI only hides what the server already refuses.
- The **audit log is immutable**: append-only, SHA-256 hash-chained with key-sorted JSON, verified on the Audit page. AI entries record the model and prompt version.
- **Prompt-injection handling:** document text is wrapped as `<untrusted_document>`, the system prompt forbids following it, output is JSON-schema constrained and Zod-validated, values are sanitised, and instruction-like text raises a "NEEDS MANUAL VERIFICATION" flag. AI output never changes state.
- Uploads are limited by MIME type and size (10 MB) and stored encrypted. Downloads use signed 5-minute URLs plus a session and org check. Storage rules deny all direct access.
- **Consent and data rights:** consent is captured at intake and versioned. Each student has a JSON data export and a permanent deletion (owner only; requires typing the student's full name; the audit log records the deletion without personal data).
- AI calls are rate-limited per user. Security headers are set (frame-deny, nosniff, referrer policy).

## Deploy

**Vercel (app)**
1. Import the repo.
2. Set `SESSION_SECRET`, `STORAGE_ENCRYPTION_KEY`, `DEMO_MODE=false`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `FIREBASE_SERVICE_ACCOUNT_JSON` and the `NEXT_PUBLIC_FIREBASE_*` variables.
3. Node 22.

**Firebase**
```bash
npm i -g firebase-tools && firebase login
firebase use <project>
firebase deploy --only firestore:rules,firestore:indexes,storage
cd functions && npm install && npm run build && cd .. && firebase deploy --only functions
```
Then create the organisation and the first owner user (a `users/{uid}` doc with `role: "owner"`). The `syncUserClaims` function sets the custom claims that the rules rely on.

Without Firebase, demo mode on Vercel uses `/tmp`, which is ephemeral per instance. Fine for a demo; never for real data.

## Adding a new country (e.g. Ireland)

1. `src/domain/types.ts`: add `"IE"` to `CountryCode`.
2. `src/domain/countries.ts`: add a `CountryDef` with:
   - its checks (`requiredBefore`, `blocking`, optional `ruleKey`)
   - its document checklist
   - its attestation templates
   - its `deadlineRuleKeys`
3. `src/domain/funds.ts`: add an `ieFunds()` formula that reads **only** rule values via `ctx.num(...)`.
4. Seed or create its rules on the **Rules** page (`funds.*`, `funds.holding_days`, `funds.statement_max_age_days`, plus any switches referenced by checks), with source URLs. A manager verifies them.
5. Add programmes on the **Universities** page.
6. Add tests in `tests/funds.test.ts`.

No other code changes are needed. Eligibility, gates, tasks, the report and the UI are all driven by the country definition and the rules.

## Testing

`npm test` runs 64 tests covering:
- the 28-day window: day-19 failure, the 31-day rule, coverage, carry-forward balances, deposits
- funds formulas for all four countries, plus FX and rule scoping
- rule staleness, and that no case is GREEN on an Unverified, Conflicting, Stale or missing rule
- cross-document consistency and document completeness
- gate enforcement:
  - direct service calls, the REST endpoints and forged tokens
  - cross-org access
  - two-person confirmation, and re-checks at execution
  - the override and acknowledgment lifecycle
  - a static check that the Firestore rules deny gated writes
- audit-chain tamper detection, transaction rollback, prompt-injection handling, rate limiting

`npm run test:rules` additionally runs the rules against the emulator (not run in CI by default).

## Production hardening still to do

- The AI rate limiter is in-process. Back it with Firestore or Redis for multi-instance deployments.
- Cloud Functions are written against firebase-functions v2 but **were not deployed or executed** in this build.
- The Firestore-rules emulator test was not run here (no Java or emulator). The static rules check and the service-level tests did run.
- Claude extraction was not exercised against the live API in this build (no key). The adapter follows the SDK's documented types and type-checks.
