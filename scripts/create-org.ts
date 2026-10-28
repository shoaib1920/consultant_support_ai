// Onboards a real consultancy: creates the organisation, its owner account and its own rules table.
// Usage: npm run create-org -- --name "Lahore Study Consultants" --owner "Ali Khan" --email ali@example.com
import "./load-env";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v || v.startsWith("--")) {
    console.error(`Missing --${name}.\nUsage: npm run create-org -- --name "Consultancy name" --owner "Owner name" --email owner@example.com`);
    process.exit(1);
  }
  return v;
}

(async () => {
  const name = arg("name");
  const ownerName = arg("owner");
  const ownerEmail = arg("email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) throw new Error(`Not a valid email: ${ownerEmail}`);
  const { getRepo, firebaseConfigured } = await import("../src/server/db");
  if (!firebaseConfigured()) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set in .env.local; a real consultancy must live in Firestore.");
  const { createOrganization } = await import("../src/server/services/orgs");
  const r = await createOrganization(await getRepo(), { name, ownerName, ownerEmail });
  console.log(`\nCreated "${name}"`);
  console.log(`  organisation id : ${r.orgId}`);
  console.log(`  owner           : ${ownerName} <${ownerEmail}>`);
  console.log(`  rules           : ${r.rules} (all Unverified until their manager checks them)`);
  console.log(`\nSend the owner this link to set a password, then they sign in at your app's /login:\n${r.setupLink}\n`);
  process.exit(0);
})().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
