"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["", "Risk report"],
  ["/documents", "Documents"],
  ["/eligibility", "Eligibility & gates data"],
  ["/financial", "Financial"],
  ["/gates", "Gates & pre-flight"],
  ["/payments", "Payments"],
  ["/tasks", "Tasks & messages"],
  ["/audit", "Audit"],
] as const;

export function CaseTabs({ id }: { id: string }) {
  const path = usePathname();
  return (
    <nav className="no-print flex gap-1 overflow-x-auto border-b" aria-label="Case sections">
      {TABS.map(([suffix, label]) => {
        const href = `/cases/${id}${suffix}`;
        const active = path === href;
        return (
          <Link key={suffix} href={href} className={cn("shrink-0 border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
