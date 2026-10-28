// Immutable, hash-chained audit log. Each entry's hash covers its content and the previous
// entry's hash, so any edit or deletion breaks the chain (verifyChain detects it).
// Firestore rules deny update/delete on auditLog for every client.

import { sha256 } from "../crypto";
import { type Repo, newId, nowISO } from "../db";
import type { Actor } from "../auth/session";
import type { AuditEntry } from "@/domain/types";

export interface AuditInput {
  action: string;
  entity: string;
  entityId: string;
  caseId?: string;
  before?: unknown;
  after?: unknown;
  ai?: AuditEntry["ai"];
}

export type AuditActor = Pick<Actor, "id" | "name" | "role" | "organizationId"> | { id: "system"; name: "System"; role: "system"; organizationId: string };

/** Key-sorted JSON so the hash is stable regardless of how the datastore orders map keys. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

function hashOf(e: Omit<AuditEntry, "hash">): string {
  return sha256(stableStringify([e.organizationId, e.seq, e.at, e.userId, e.action, e.entity, e.entityId, e.caseId ?? null, e.before ?? null, e.after ?? null, e.ai ?? null, e.prevHash]));
}

/** Must be called inside repo.transaction() together with the change it records. */
export async function audit(tx: Repo, actor: AuditActor, input: AuditInput): Promise<AuditEntry> {
  const head = (await tx.get<{ seq: number; hash: string }>("auditHeads", actor.organizationId)) ?? { seq: 0, hash: "GENESIS" };
  const base: Omit<AuditEntry, "hash"> = {
    id: newId("au_"),
    organizationId: actor.organizationId,
    seq: head.seq + 1,
    at: nowISO(),
    userId: actor.id,
    userName: actor.name,
    role: actor.role,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    caseId: input.caseId,
    before: input.before === undefined ? undefined : JSON.parse(JSON.stringify(input.before)),
    after: input.after === undefined ? undefined : JSON.parse(JSON.stringify(input.after)),
    ai: input.ai,
    prevHash: head.hash,
  };
  const entry: AuditEntry = { ...base, hash: hashOf(base) };
  await tx.set("auditLog", entry.id, entry);
  await tx.set("auditHeads", actor.organizationId, { seq: entry.seq, hash: entry.hash, organizationId: actor.organizationId });
  return entry;
}

export async function verifyChain(repo: Repo, organizationId: string): Promise<{ ok: boolean; count: number; brokenAt?: number }> {
  const entries = await repo.list<AuditEntry>("auditLog", [["organizationId", "==", organizationId]], { orderBy: "seq" });
  let prev = "GENESIS";
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || hashOf(rest) !== hash) return { ok: false, count: entries.length, brokenAt: e.seq };
    prev = hash;
  }
  const head = await repo.get<{ seq: number; hash: string }>("auditHeads", organizationId);
  if (head && entries.length && head.hash !== prev) return { ok: false, count: entries.length, brokenAt: head.seq };
  return { ok: true, count: entries.length };
}
