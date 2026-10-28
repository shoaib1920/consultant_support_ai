// Usage: npm run seed   (re-creates the demo organisation; uses Firestore if FIREBASE_SERVICE_ACCOUNT_JSON is set)
// Reads .env.local so you can seed Firestore from your machine before deploying.
import fs from "node:fs";

if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

(async () => {
  const { getRepo } = await import("../src/server/db");
  const { seedDemo } = await import("../src/server/seed/seed");
  const repo = await getRepo();
  const t = Date.now();
  console.log(`Seeding demo data into ${repo.kind} datastore… (Firestore takes 1–3 minutes)`);
  const r = await seedDemo(repo);
  console.log(`Seeded ${r.cases} demo cases into ${repo.kind} in ${Math.round((Date.now() - t) / 1000)} s`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
