// Runs against the Firestore emulator: `npm run test:rules` (needs firebase-tools + Java).
// Proves a signed-in client cannot bypass gates with direct Firestore writes.
import fs from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
const ORG = "org_demo";

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "visaguard-rules-test", firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "cases/c1"), { organizationId: ORG, studentId: "s1", stage: "Docs Verified", universityName: "X", light: "RED" });
    await setDoc(doc(db, "auditLog/a1"), { organizationId: ORG, action: "x" });
    await setDoc(doc(db, "eligibilityResults/e1"), { organizationId: ORG, light: "RED" });
  });
});
afterAll(async () => env?.cleanup());

const as = (role: string, org = ORG) => env.authenticatedContext(`u_${role}`, { orgId: org, role }).firestore();

describe("firestore.rules", () => {
  it("staff cannot change a case stage or its light — even the owner", async () => {
    await assertFails(updateDoc(doc(as("owner"), "cases/c1"), { stage: "Payment Authorized" }));
    await assertFails(updateDoc(doc(as("manager"), "cases/c1"), { light: "GREEN" }));
  });
  it("staff can edit descriptive case fields", async () => {
    await assertSucceeds(updateDoc(doc(as("officer"), "cases/c1"), { universityName: "Y" }));
  });
  it("nobody can write payments, approvals or gate events from the client", async () => {
    await assertFails(setDoc(doc(as("owner"), "payments/p1"), { organizationId: ORG, refundable: false, amount: 1 }));
    await assertFails(setDoc(doc(as("manager"), "approvals/a1"), { organizationId: ORG, status: "approved" }));
    await assertFails(setDoc(doc(as("officer"), "gateEvents/g1"), { organizationId: ORG }));
  });
  it("audit log is immutable", async () => {
    await assertFails(updateDoc(doc(as("owner"), "auditLog/a1"), { action: "edited" }));
  });
  it("students cannot read risk scores; other orgs cannot read anything", async () => {
    await assertFails(getDoc(doc(as("student"), "eligibilityResults/e1")));
    await assertFails(getDoc(doc(as("owner", "org_other"), "cases/c1")));
    await assertSucceeds(getDoc(doc(as("officer"), "eligibilityResults/e1")));
  });
});
