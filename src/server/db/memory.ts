// MOCK datastore: in-process Map persisted to a JSON file so data survives dev-server restarts.
// Transactions are serialised with a mutex and roll back on error (snapshot restore).

import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { type CollectionName, type ListOptions, type Repo, type Where, matches, sortAndLimit } from "./repo";

type Store = Record<string, Record<string, unknown>>;

const txScope = new AsyncLocalStorage<boolean>();

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  private store: Store = {};
  private lock: Promise<unknown> = Promise.resolve();
  private readonly file?: string;

  constructor(dataDir?: string) {
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      this.file = path.join(dataDir, "db.json");
      if (fs.existsSync(this.file)) {
        try {
          this.store = JSON.parse(fs.readFileSync(this.file, "utf8"));
        } catch {
          this.store = {};
        }
      }
    }
  }

  private persist() {
    if (!this.file || txScope.getStore()) return;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.store));
    fs.renameSync(tmp, this.file);
  }

  private col(c: CollectionName) {
    return (this.store[c] ??= {});
  }

  async get<T>(c: CollectionName, id: string): Promise<T | null> {
    const v = this.col(c)[id];
    return v ? (structuredClone(v) as T) : null;
  }

  async list<T>(c: CollectionName, where?: Where[], opts?: ListOptions): Promise<T[]> {
    const rows = Object.values(this.col(c)).filter((d) => matches(d, where));
    return sortAndLimit(rows, opts).map((r) => structuredClone(r) as T);
  }

  async set<T extends object>(c: CollectionName, id: string, doc: T): Promise<void> {
    this.col(c)[id] = structuredClone(doc);
    this.persist();
  }

  async update<T extends object>(c: CollectionName, id: string, patch: Partial<T>): Promise<void> {
    const cur = this.col(c)[id];
    if (!cur) throw new Error(`${c}/${id} not found`);
    this.col(c)[id] = { ...(cur as object), ...structuredClone(patch) };
    this.persist();
  }

  async delete(c: CollectionName, id: string): Promise<void> {
    delete this.col(c)[id];
    this.persist();
  }

  async transaction<R>(fn: (tx: Repo) => Promise<R>): Promise<R> {
    if (txScope.getStore()) return fn(this); // re-entrant
    const run = async () => {
      const snapshot = structuredClone(this.store);
      try {
        const r = await txScope.run(true, () => fn(this));
        this.persist();
        return r;
      } catch (e) {
        this.store = snapshot;
        throw e;
      }
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }

  async wipe(): Promise<void> {
    this.store = {};
    this.persist();
  }
}
