// Role-based permissions. The same matrix is mirrored in firestore.rules.

import type { Role } from "@/domain/types";

export type Permission =
  | "student.read"
  | "student.write"
  | "student.delete"
  | "case.read"
  | "case.write"
  | "case.transition"
  | "doc.upload"
  | "doc.review"
  | "analysis.run"
  | "rules.read"
  | "rules.edit"
  | "rules.verify"
  | "programmes.edit"
  | "approve.manager"
  | "override.grant"
  | "preflight.request"
  | "preflight.confirm_manager"
  | "payment.record"
  | "audit.read"
  | "users.manage"
  | "demo.reset"
  | "dashboard.owner"
  | "portal.self";

const ALL: Permission[] = [
  "student.read",
  "student.write",
  "student.delete",
  "case.read",
  "case.write",
  "case.transition",
  "doc.upload",
  "doc.review",
  "analysis.run",
  "rules.read",
  "rules.edit",
  "rules.verify",
  "programmes.edit",
  "approve.manager",
  "override.grant",
  "preflight.request",
  "preflight.confirm_manager",
  "payment.record",
  "audit.read",
  "users.manage",
  "demo.reset",
  "dashboard.owner",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== "users.manage" && p !== "student.delete"),
  officer: ["student.read", "student.write", "case.read", "case.write", "case.transition", "doc.upload", "doc.review", "analysis.run", "rules.read", "preflight.request", "payment.record", "audit.read"],
  counsellor: ["student.read", "student.write", "case.read", "case.write", "doc.upload", "analysis.run", "rules.read"],
  student: ["portal.self"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / Admin",
  manager: "Manager",
  officer: "Processing Officer",
  counsellor: "Counsellor",
  student: "Student",
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
