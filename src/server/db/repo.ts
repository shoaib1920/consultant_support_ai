// Storage-agnostic repository interface. Two implementations:
//  - MemoryRepo: JSON-file backed (MOCK datastore for local/demo use)
//  - FirestoreRepo: firebase-admin (production)

export const COLLECTIONS = [
  "organizations",
  "users",
  "students",
  "cases",
  "documents",
  "extractedFields",
  "attestations",
  "rules",
  "ruleChangelog",
  "universities",
  "programmes",
  "eligibilityResults",
  "financialAnalyses",
  "matchResults",
  "gateEvents",
  "approvals",
  "riskAcknowledgments",
  "payments",
  "tasks",
  "notifications",
  "auditLog",
  "auditHeads",
  "files", // MOCK storage blobs index (memory mode only)
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export type WhereOp = "==" | "!=" | "in" | "array-contains" | ">=" | "<=" | ">" | "<";
export type Where = [field: string, op: WhereOp, value: unknown];

export interface ListOptions {
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

export interface Repo {
  readonly kind: "memory" | "firestore";
  get<T>(col: CollectionName, id: string): Promise<T | null>;
  list<T>(col: CollectionName, where?: Where[], opts?: ListOptions): Promise<T[]>;
  set<T extends object>(col: CollectionName, id: string, doc: T): Promise<void>;
  update<T extends object>(col: CollectionName, id: string, patch: Partial<T>): Promise<void>;
  delete(col: CollectionName, id: string): Promise<void>;
  /** Runs fn atomically. All reads should precede writes (Firestore requirement). */
  transaction<R>(fn: (tx: Repo) => Promise<R>): Promise<R>;
  wipe(): Promise<void>;
}

export function newId(prefix = ""): string {
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  return prefix + Array.from(rnd, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

export function nowISO(): string {
  return new Date().toISOString();
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function matches(doc: unknown, where: Where[] = []): boolean {
  return where.every(([f, op, v]) => {
    const x = getPath(doc, f) as never;
    switch (op) {
      case "==":
        return x === v;
      case "!=":
        return x !== v;
      case "in":
        return (v as unknown[]).includes(x);
      case "array-contains":
        return Array.isArray(x) && (x as unknown[]).includes(v);
      case ">=":
        return x >= (v as never);
      case "<=":
        return x <= (v as never);
      case ">":
        return x > (v as never);
      case "<":
        return x < (v as never);
    }
  });
}

export function sortAndLimit<T>(rows: T[], opts?: ListOptions): T[] {
  let out = rows;
  if (opts?.orderBy) {
    const k = opts.orderBy;
    out = [...out].sort((a, b) => {
      const x = getPath(a, k) as string | number;
      const y = getPath(b, k) as string | number;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return opts.desc ? -c : c;
    });
  }
  return opts?.limit ? out.slice(0, opts.limit) : out;
}
