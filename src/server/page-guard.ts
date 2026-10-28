import { notFound, redirect } from "next/navigation";
import { can, type Permission } from "./auth/rbac";
import { type Actor, getActor } from "./auth/session";

/** For server components: signed-in staff with the permission, else redirect/404. */
export async function staffPage(perm: Permission): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (a.role === "student") redirect("/portal");
  if (!can(a.role, perm)) notFound();
  return a;
}

export async function studentPage(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (a.role !== "student" || !a.studentId) redirect("/dashboard");
  return a;
}
