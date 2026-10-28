import path from "node:path";
import { MemoryRepo } from "./memory";
import type { Repo } from "./repo";

export * from "./repo";

const g = globalThis as unknown as { __vgRepo?: Repo; __vgRepoPromise?: Promise<Repo> };

export function firebaseConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
}

export function dataDir(): string {
  return process.env.VISAGUARD_DATA_DIR ? path.resolve(process.env.VISAGUARD_DATA_DIR) : process.env.VERCEL ? "/tmp/visaguard" : path.resolve(".data");
}

async function create(): Promise<Repo> {
  if (firebaseConfigured()) {
    const { getAdminApp } = await import("../firebase-admin");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { FirestoreRepo } = await import("./firestore");
    return new FirestoreRepo(getFirestore(getAdminApp()));
  }
  return new MemoryRepo(dataDir());
}

export async function getRepo(): Promise<Repo> {
  if (g.__vgRepo) return g.__vgRepo;
  g.__vgRepoPromise ??= create().then((r) => (g.__vgRepo = r));
  return g.__vgRepoPromise;
}

/** Test helper: inject a repo. */
export function setRepo(r: Repo) {
  g.__vgRepo = r;
  g.__vgRepoPromise = Promise.resolve(r);
}
