"use client";

import * as React from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Check, Copy, Loader2, Menu, Moon, Sun, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/actions/result";
import { Alert, Button, type ButtonProps } from "./ui/primitives";
import { ResultMessage } from "./action-form";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {mounted && resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function MobileNavToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
        <Menu />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-card p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <div onClick={() => setOpen(false)}>{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

/** Button that invokes a bound server action (no form fields) and shows the result. */
export function ActionButton({ action, children, confirm, ...props }: ButtonProps & { action: () => Promise<ActionResult>; confirm?: string }) {
  const [pending, start] = React.useTransition();
  const [res, setRes] = React.useState<ActionResult | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-2">
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setRes(r);
            router.refresh();
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
      {res && (!res.ok || res.message) && <ResultMessage state={res} />}
      {res?.ok && typeof res.data?.url === "string" && <CopyField value={`${window.location.origin}${res.data.url}`} />}
      {res?.ok && typeof res.data?.setupLink === "string" && <CopyField value={res.data.setupLink} />}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "Copied" : label}
    </Button>
  );
}

export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <Alert tone="red" title="Something went wrong loading this page">
        <p className="text-xs">{error.message || "Unexpected error."} {error.digest && <span className="text-muted-foreground">(ref {error.digest})</span>}</p>
        <p className="mt-2 text-xs">No irreversible action was performed. You can retry safely.</p>
        <Button className="mt-3" size="sm" onClick={reset}>
          Try again
        </Button>
      </Alert>
    </div>
  );
}
