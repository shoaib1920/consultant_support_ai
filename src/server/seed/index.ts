import { type Repo, getRepo } from "../db";
import { DEMO_ORG, seedDemo } from "./seed";

export { DEMO_ORG, seedDemo };

const g = globalThis as unknown as { __vgSeeding?: Promise<unknown> };

/** In demo mode, seed automatically on first use when the datastore is empty. */
export async function ensureSeeded(repo?: Repo): Promise<void> {
  if (process.env.DEMO_MODE !== "true") return;
  const r = repo ?? (await getRepo());
  if (await r.get("organizations", DEMO_ORG)) return;
  g.__vgSeeding ??= seedDemo(r).finally(() => (g.__vgSeeding = undefined));
  await g.__vgSeeding;
}
