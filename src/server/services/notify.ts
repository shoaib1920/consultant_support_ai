import type { Notification, Role, User } from "@/domain/types";
import { type Repo, newId, nowISO } from "../db";

export async function notifyUsers(tx: Repo, organizationId: string, userIds: string[], n: Pick<Notification, "title" | "body" | "link" | "kind" | "caseId">) {
  const now = nowISO();
  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    const id = newId("nt_");
    await tx.set<Notification>("notifications", id, { id, organizationId, userId, read: false, createdAt: now, updatedAt: now, ...n });
  }
}

export async function usersWithRoles(repo: Repo, organizationId: string, roles: Role[]): Promise<User[]> {
  const users = await repo.list<User>("users", [["organizationId", "==", organizationId]]);
  return users.filter((u) => u.active && roles.includes(u.role));
}
