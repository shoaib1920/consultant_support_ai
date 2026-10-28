import { ZodError } from "zod";
import { GateError } from "@/domain/gates";
import { AuthError } from "../auth/rbac";
import { NotFoundError } from "../services/bundle";
import { ValidationError } from "../services/documents";

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  blockers?: string[];
  data?: Record<string, unknown>;
}

export async function run(fn: () => Promise<ActionResult | string | void>): Promise<ActionResult> {
  try {
    const r = await fn();
    if (typeof r === "string") return { ok: true, message: r };
    return r ?? { ok: true };
  } catch (e) {
    if (e instanceof GateError) return { ok: false, error: e.message, blockers: e.blockers };
    if (e instanceof ZodError) return { ok: false, error: "Please fix the highlighted fields", blockers: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
    if (e instanceof AuthError || e instanceof ValidationError || e instanceof NotFoundError) return { ok: false, error: e.message };
    if (e instanceof Error && (e.name === "RateLimitError" || e.name === "AIError")) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. The action was not completed." };
  }
}

export function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}

/** FormData -> plain object (checkbox "on" -> true, empty strings kept for zod transforms). */
export function formObject(fd: FormData, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, fd.get(k) === "on" ? true : (fd.get(k) ?? undefined)]));
}
