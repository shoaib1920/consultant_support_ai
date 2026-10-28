import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { DemoBanner, Disclaimer } from "@/components/app-shell";
import { ThemeToggle } from "@/components/client-bits";
import { Button } from "@/components/ui/primitives";
import { logoutAction } from "@/server/actions";
import { demoMode } from "@/server/auth/session";
import { studentPage } from "@/server/page-guard";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await studentPage();
  return (
    <div className="min-h-screen">
      {demoMode() && <DemoBanner />}
      <header className="flex h-12 items-center gap-2 border-b px-4">
        <Link href="/portal" className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="size-4 text-primary" /> Student portal</Link>
        <span className="ml-auto text-sm text-muted-foreground">{actor.name}</span>
        <ThemeToggle />
        <form action={logoutAction}><Button variant="ghost" size="icon" aria-label="Sign out"><LogOut /></Button></form>
      </header>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
      <Disclaimer />
    </div>
  );
}
