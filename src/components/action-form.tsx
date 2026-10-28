"use client";

// Wraps a server action: pending state, inline error/success, and gate blockers.

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import type { ActionResult } from "@/server/actions/result";
import { Alert, Button, type ButtonProps } from "./ui/primitives";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? pendingText ?? "Working…" : children}
    </Button>
  );
}

export function ResultMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (state.ok) return state.message ? <Alert tone="green">{state.message}</Alert> : null;
  return (
    <Alert tone="red" title={<span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4" /> {state.error}</span>}>
      {state.blockers && state.blockers.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {state.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (r: ActionResult) => void;
}) {
  const ref = React.useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(r);
    }
    return r;
  }, null);
  return (
    <form ref={ref} action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      <ResultMessage state={state} />
    </form>
  );
}
