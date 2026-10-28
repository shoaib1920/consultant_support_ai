// Production datastore on Firestore via firebase-admin (server-side only; bypasses client rules,
// which is why every write path in src/server/services enforces roles and gates itself).

import type { Firestore, Transaction, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { type CollectionName, type ListOptions, type Repo, type Where } from "./repo";

function applyQuery(q: Query, where: Where[] = [], opts?: ListOptions): Query {
  for (const [f, op, v] of where) q = q.where(f, op, v);
  if (opts?.orderBy) q = q.orderBy(opts.orderBy, opts.desc ? "desc" : "asc");
  if (opts?.limit) q = q.limit(opts.limit);
  return q;
}

function clean<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)); // strip undefined (Firestore rejects it)
}

/** Update patch for Firestore: undefined means "remove this field" (Firestore rejects raw undefined). */
async function firestorePatch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { FieldValue } = await import("firebase-admin/firestore");
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? FieldValue.delete() : clean(v)]));
}

type Pending = { op: "set"; doc: Record<string, unknown> } | { op: "update"; patch: Record<string, unknown> } | { op: "delete" };

/**
 * Inside a transaction, writes are BUFFERED and applied at commit. Firestore requires all reads
 * before any write; buffering lets services read (e.g. the audit chain head) after deciding what
 * to write, while reads still see the transaction's own pending writes.
 */
export class FirestoreRepo implements Repo {
  readonly kind = "firestore" as const;
  private pending = new Map<string, Pending[]>();
  constructor(
    private readonly db: Firestore,
    private readonly tx?: Transaction,
  ) {}

  private key(c: CollectionName, id: string) {
    return `${c}/${id}`;
  }

  private overlay(c: CollectionName, id: string, base: Record<string, unknown> | null): Record<string, unknown> | null {
    let cur = base;
    for (const p of this.pending.get(this.key(c, id)) ?? []) {
      if (p.op === "set") cur = { ...p.doc };
      else if (p.op === "update") cur = cur ? Object.fromEntries(Object.entries({ ...cur, ...p.patch }).filter(([, v]) => v !== undefined)) : cur;
      else cur = null;
    }
    return cur;
  }

  private queue(c: CollectionName, id: string, p: Pending) {
    const k = this.key(c, id);
    this.pending.set(k, [...(this.pending.get(k) ?? []), p]);
  }

  async get<T>(c: CollectionName, id: string): Promise<T | null> {
    const ref = this.db.collection(c).doc(id);
    const snap = this.tx ? await this.tx.get(ref) : await ref.get();
    const base = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    return (this.tx ? this.overlay(c, id, base) : base) as T | null;
  }

  async list<T>(c: CollectionName, where?: Where[], opts?: ListOptions): Promise<T[]> {
    const q = applyQuery(this.db.collection(c), where, opts);
    const snap = this.tx ? await this.tx.get(q) : await q.get();
    // always expose the real document id (some internal docs, e.g. auditHeads, have no id field)
    return snap.docs.map((d: QueryDocumentSnapshot) => (this.tx ? this.overlay(c, d.id, { id: d.id, ...d.data() }) : { id: d.id, ...d.data() }) as T).filter(Boolean);
  }

  async set<T extends object>(c: CollectionName, id: string, doc: T): Promise<void> {
    if (this.tx) return this.queue(c, id, { op: "set", doc: clean(doc) as Record<string, unknown> });
    await this.db.collection(c).doc(id).set(clean(doc));
  }

  async update<T extends object>(c: CollectionName, id: string, patch: Partial<T>): Promise<void> {
    if (this.tx) return this.queue(c, id, { op: "update", patch: { ...(patch as Record<string, unknown>) } });
    await this.db.collection(c).doc(id).update(await firestorePatch(patch as Record<string, unknown>));
  }

  async delete(c: CollectionName, id: string): Promise<void> {
    if (this.tx) return this.queue(c, id, { op: "delete" });
    await this.db.collection(c).doc(id).delete();
  }

  private async flush() {
    for (const [k, ops] of this.pending) {
      const [c, id] = k.split("/");
      const ref = this.db.collection(c).doc(id);
      for (const p of ops) {
        if (p.op === "set") this.tx!.set(ref, p.doc);
        else if (p.op === "update") this.tx!.update(ref, await firestorePatch(p.patch));
        else this.tx!.delete(ref);
      }
    }
    this.pending.clear();
  }

  async transaction<R>(fn: (tx: Repo) => Promise<R>): Promise<R> {
    if (this.tx) return fn(this);
    return this.db.runTransaction(async (t: Transaction) => {
      const inner = new FirestoreRepo(this.db, t);
      const r = await fn(inner);
      await inner.flush();
      return r;
    });
  }

  async wipe(): Promise<void> {
    throw new Error("wipe() is disabled on Firestore. Use the demo reset which deletes only demo-organisation data.");
  }
}
