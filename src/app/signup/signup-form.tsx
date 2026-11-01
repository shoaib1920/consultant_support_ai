"use client";

import * as React from "react";
import Link from "next/link";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { TRIAL_DAYS } from "@/domain/trial";
import { firebaseSessionAction, signupAction } from "@/server/actions";
import { app, reloadIfStaleDeployment } from "../login/firebase-login";

export function SignupForm() {
  const [error, setError] = React.useState<{ title: string; items?: string[] } | null>(null);
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const fd = new FormData(e.currentTarget);
        try {
          const r = await signupAction(null, fd);
          if (!r.ok) return setError({ title: r.error ?? "Sign-up failed.", items: r.blockers });
          // the account exists now; sign in with the same details
          const cred = await signInWithEmailAndPassword(getAuth(app()), String(fd.get("email")).trim().toLowerCase(), String(fd.get("password")));
          const s = await firebaseSessionAction(await cred.user.getIdToken());
          if (!s.ok) throw new Error(s.error);
          router.push("/dashboard");
        } catch (err) {
          if (reloadIfStaleDeployment(err, (title) => setError({ title }))) return;
          setError({ title: err instanceof Error && !(err as { code?: string }).code ? err.message : "Your account was created, but signing in failed. Go to the sign-in page and sign in with the same email and password." });
        } finally {
          setPending(false);
        }
      }}
    >
      <Field label="Consultancy name">
        <Input name="consultancyName" required minLength={2} maxLength={120} autoComplete="organization" placeholder="e.g. Lahore Study Consultants" />
      </Field>
      <Field label="Your full name">
        <Input name="name" required minLength={2} maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Work email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <Input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="agree" required className="mt-1" />
        <span className="text-muted-foreground">
          I understand VisaGuard is a decision-support tool, not legal or immigration advice, and I will only upload documents my students have consented to share.
        </span>
      </label>
      <Button disabled={pending}>{pending ? "Creating your account…" : `Start my ${TRIAL_DAYS}-day free trial`}</Button>
      <p className="text-xs text-muted-foreground">No card required. You become the Owner of your consultancy's workspace and can add staff afterwards.</p>
      {error && (
        <Alert tone="red" title={<span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4" /> {error.title}</span>}>
          {error.items && error.items.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {error.items.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
