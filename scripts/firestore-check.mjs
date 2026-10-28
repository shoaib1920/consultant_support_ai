// Diagnostic: verifies Firestore credentials in .env.local and counts demo data. Usage: node scripts/firestore-check.mjs
import fs from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("FIREBASE_SERVICE_ACCOUNT_JSON="));
const db = getFirestore(initializeApp({ credential: cert(JSON.parse(line.slice("FIREBASE_SERVICE_ACCOUNT_JSON=".length))) }));
const t = Date.now();
try {
  const out = {};
  for (const c of ["organizations", "users", "rules", "programmes", "students", "cases", "documents", "files", "eligibilityResults", "financialAnalyses", "gateEvents", "tasks", "auditLog"]) out[c] = (await db.collection(c).count().get()).data().count;
  console.log("connected in", Date.now() - t, "ms", out);
  const lights = (await db.collection("cases").get()).docs.map((d) => `${d.id}:${d.data().light ?? "-"}`);
  console.log(lights.join("  "));
} catch (e) {
  console.log("ERROR", e.code, e.message?.slice(0, 300));
}
process.exit(0);
