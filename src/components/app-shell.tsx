import Link from "next/link";
import { Bell, BookOpenCheck, ClipboardList, FileClock, Gauge, GraduationCap, LogOut, Scale, ShieldCheck, Users, Wallet, Settings, CheckSquare, FlaskConical } from "lucide-react";
import { can, ROLE_LABELS, type Permission } from "@/server/auth/rbac";
import type { Actor } from "@/server/auth/session";
import { logoutAction } from "@/server/actions";
import { MobileNavToggle, ThemeToggle } from "./client-bits";
import { Badge, Button } from "./ui/primitives";

const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm: Permission }[] = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge, perm: "case.read" },
  { href: "/cases", label: "Cases", icon: ClipboardList, perm: "case.read" },
  { href: "/students", label: "Students", icon: Users, perm: "student.read" },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, perm: "preflight.confirm_manager" },
  { href: "/tasks", label: "Tasks & deadlines", icon: BookOpenCheck, perm: "case.read" },
  { href: "/payments", label: "Payments ledger", icon: Wallet, perm: "case.read" },
  { href: "/rules", label: "Rules engine", icon: Scale, perm: "rules.read" },
  { href: "/programmes", label: "Universities", icon: GraduationCap, perm: "rules.read" },
  { href: "/audit", label: "Audit log", icon: FileClock, perm: "audit.read" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "case.read" },
];

function NavLinks({ actor }: { actor: Actor }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((n) => can(actor.role, n.perm)).map((n) => (
        <Link key={n.href} href={n.href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
          <n.icon className="size-4" /> {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function DemoBanner() {
  return (
    <div className="no-print flex items-center justify-center gap-2 bg-amber-soft px-3 py-1.5 text-center text-xs text-amber">
      <FlaskConical className="size-3.5" />
      <span>
        <strong>Demo mode</strong> — fictional students, sample programmes and seed rules. Reset any time from <Link href="/settings" className="underline">Settings</Link>.
      </span>
    </div>
  );
}

export function Disclaimer() {
  return (
    <footer className="no-print mt-10 border-t px-4 py-4 text-[11px] leading-relaxed text-muted-foreground">
      <strong>Disclaimer:</strong> VisaGuard is a decision-support tool, not legal or immigration advice. Outputs depend on rules verified by your staff and on the documents provided. It never guarantees admission or visa approval. AI recommends and explains; a human decides.
    </footer>
  );
}

export function AppShell({ actor, demo, unread, children }: { actor: Actor; demo: boolean; unread: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {demo && <DemoBanner />}
      <div className="flex">
        <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card p-3 lg:flex">
          <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 py-1">
            <ShieldCheck className="size-5 text-primary" />
            <span className="font-semibold">VisaGuard</span>
          </Link>
          <NavLinks actor={actor} />
          <div className="mt-auto rounded-md border p-2 text-xs">
            <div className="font-medium">{actor.name}</div>
            <div className="text-muted-foreground">{ROLE_LABELS[actor.role]}</div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur">
            <MobileNavToggle>
              <NavLinks actor={actor} />
            </MobileNavToggle>
            <Link href="/dashboard" className="flex items-center gap-1.5 font-semibold lg:hidden">
              <ShieldCheck className="size-4 text-primary" /> VisaGuard
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <Badge tone="neutral" className="hidden sm:inline-flex">{ROLE_LABELS[actor.role]}</Badge>
              <Link href="/tasks#notifications" className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-muted" aria-label={`${unread} unread notifications`}>
                <Bell className="size-4" />
                {unread > 0 && <span className="absolute right-1 top-1 rounded-full bg-red px-1 text-[10px] font-semibold text-white">{unread}</span>}
              </Link>
              <ThemeToggle />
              <form action={logoutAction}>
                <Button variant="ghost" size="icon" aria-label="Sign out">
                  <LogOut />
                </Button>
              </form>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}
