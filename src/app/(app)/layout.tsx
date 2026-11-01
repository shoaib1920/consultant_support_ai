import { redirect } from "next/navigation";
import { trialInfo } from "@/domain/trial";
import type { Notification, Organization } from "@/domain/types";
import { AppShell } from "@/components/app-shell";
import { demoMode, getActor } from "@/server/auth/session";
import { getRepo } from "@/server/db";
import { DEMO_ORG, ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await ensureSeeded();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "student") redirect("/portal");
  const repo = await getRepo();
  const unread = (await repo.list<Notification>("notifications", [["organizationId", "==", actor.organizationId], ["userId", "==", actor.id], ["read", "==", false]])).length;
  const trial = trialInfo(await repo.get<Organization>("organizations", actor.organizationId));
  return (
    // a consultancy that signed up on a demo deployment must not see the "fictional data" banner
    <AppShell actor={actor} demo={demoMode() && actor.organizationId === DEMO_ORG} unread={unread} trialDaysLeft={trial.onTrial ? trial.daysLeft : undefined}>
      {children}
    </AppShell>
  );
}
