import { redirect } from "next/navigation";
import type { Notification } from "@/domain/types";
import { AppShell } from "@/components/app-shell";
import { demoMode, getActor } from "@/server/auth/session";
import { getRepo } from "@/server/db";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await ensureSeeded();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "student") redirect("/portal");
  const repo = await getRepo();
  const unread = (await repo.list<Notification>("notifications", [["organizationId", "==", actor.organizationId], ["userId", "==", actor.id], ["read", "==", false]])).length;
  return (
    <AppShell actor={actor} demo={demoMode()} unread={unread}>
      {children}
    </AppShell>
  );
}
