// Usage: npm run seed   (re-creates the demo organisation; uses Firestore if FIREBASE_SERVICE_ACCOUNT_JSON is set)
// Reads .env.local so you can seed Firestore from your machine before deploying.
import "./load-env";

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
