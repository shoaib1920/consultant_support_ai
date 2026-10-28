// File storage with three backends (FILE_STORAGE env):
//  - "firestore": encrypted chunks inside Firestore — works on the free Spark plan (default when Firebase is configured)
//  - "firebase":  Firebase Storage + its signed URLs (needs the Blaze plan)
//  - "local":     MOCK — encrypted files on local disk (default without Firebase)
// Files are only ever served via short-lived signed URLs, and are AES-256-GCM encrypted in "firestore"/"local" modes.

import fs from "node:fs";
import path from "node:path";
import { dataDir, firebaseConfigured, getRepo } from "../db";
import { decrypt, encrypt, sha256, signPayload, verifyPayload } from "../crypto";

const SIGNED_URL_TTL_SECONDS = 300;
const CHUNK_BYTES = 600_000; // base64 ≈ 800 KB, under Firestore's 1 MiB document limit

type Mode = "firestore" | "firebase" | "local";

export function storageMode(): Mode {
  const m = process.env.FILE_STORAGE;
  if (m === "firestore" || m === "firebase" || m === "local") return m;
  return firebaseConfigured() ? "firestore" : "local";
}

interface FileChunk {
  id: string;
  organizationId: string;
  storagePath: string;
  index: number;
  total: number;
  mimeType: string;
  data: string; // base64 of encrypted bytes
}

function orgOf(storagePath: string): string {
  return storagePath.match(/^orgs\/([^/]+)\//)?.[1] ?? "unknown";
}

function chunkId(storagePath: string, i: number) {
  return `fc_${sha256(storagePath).slice(0, 32)}_${i}`;
}

function localPath(storagePath: string): string {
  const safe = storagePath.replace(/\.\./g, "").replace(/^\/+/, "");
  return path.join(dataDir(), "uploads", safe + ".enc");
}

async function bucket() {
  const { getStorage } = await import("firebase-admin/storage");
  const { getAdminApp } = await import("../firebase-admin");
  return getStorage(getAdminApp()).bucket();
}

export async function putFile(storagePath: string, bytes: Buffer, mimeType: string): Promise<void> {
  const mode = storageMode();
  if (mode === "firebase") {
    await (await bucket()).file(storagePath).save(bytes, { contentType: mimeType, resumable: false });
    return;
  }
  if (mode === "firestore") {
    const enc = encrypt(bytes);
    const total = Math.max(1, Math.ceil(enc.length / CHUNK_BYTES));
    const repo = await getRepo();
    for (let i = 0; i < total; i++) {
      const c: FileChunk = { id: chunkId(storagePath, i), organizationId: orgOf(storagePath), storagePath, index: i, total, mimeType, data: enc.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString("base64") };
      await repo.set("files", c.id, c);
    }
    return;
  }
  const p = localPath(storagePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encrypt(bytes));
}

export async function getFile(storagePath: string): Promise<Buffer | null> {
  const mode = storageMode();
  if (mode === "firebase") {
    const [buf] = await (await bucket()).file(storagePath).download();
    return buf;
  }
  if (mode === "firestore") {
    const repo = await getRepo();
    const first = await repo.get<FileChunk>("files", chunkId(storagePath, 0));
    if (!first) return null;
    const parts = [Buffer.from(first.data, "base64")];
    for (let i = 1; i < first.total; i++) {
      const c = await repo.get<FileChunk>("files", chunkId(storagePath, i));
      if (!c) return null;
      parts.push(Buffer.from(c.data, "base64"));
    }
    return decrypt(Buffer.concat(parts));
  }
  const p = localPath(storagePath);
  return fs.existsSync(p) ? decrypt(fs.readFileSync(p)) : null;
}

export async function deleteFile(storagePath: string): Promise<void> {
  const mode = storageMode();
  if (mode === "firebase") {
    await (await bucket()).file(storagePath).delete({ ignoreNotFound: true });
    return;
  }
  if (mode === "firestore") {
    const repo = await getRepo();
    const first = await repo.get<FileChunk>("files", chunkId(storagePath, 0));
    for (let i = 0; i < (first?.total ?? 0); i++) await repo.delete("files", chunkId(storagePath, i));
    return;
  }
  const p = localPath(storagePath);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export async function signedUrl(storagePath: string, mimeType: string, fileName: string): Promise<string> {
  if (storageMode() === "firebase") {
    const [url] = await (await bucket()).file(storagePath).getSignedUrl({ action: "read", expires: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 });
    return url;
  }
  const token = signPayload({ p: storagePath, m: mimeType, n: fileName, exp: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 });
  return `/api/files?t=${encodeURIComponent(token)}`;
}

export function verifyFileToken(token: string): { p: string; m: string; n: string } | null {
  const v = verifyPayload<{ p: string; m: string; n: string; exp: number }>(token);
  if (!v || v.exp < Date.now()) return null;
  return v;
}

/** Local mock only. Firestore-stored chunks carry organizationId and are removed with the demo org's data. */
export function wipeLocalUploads() {
  if (storageMode() !== "local") return;
  fs.rmSync(path.join(dataDir(), "uploads"), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
