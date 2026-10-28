"use client";

import * as React from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { firebaseSessionAction } from "@/server/actions";

function app() {
  return (
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    })
  );
}

export function FirebaseLogin() {
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const fd = new FormData(e.currentTarget);
        try {
          const cred = await signInWithEmailAndPassword(getAuth(app()), String(fd.get("email")), String(fd.get("password")));
          const r = await firebaseSessionAction(await cred.user.getIdToken());
          if (!r.ok) throw new Error(r.error);
          router.push("/");
        } catch (err) {
          const code = (err as { code?: string }).code ?? "";
          setError(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code) ? "Email or password is incorrect." : code.includes("too-many-requests") ? "Too many attempts. Wait a few minutes or reset your password." : err instanceof Error && !code ? err.message : "Sign-in failed. Check your connection and try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <Field label="Email">
        <Input ref={emailRef} name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      <Button disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <Button
        type="button"
        variant="link"
        className="self-start"
        onClick={async () => {
          setError(null);
          setInfo(null);
          const email = emailRef.current?.value.trim();
          if (!email) return setError("Enter your email first, then click “Forgot password?”.");
          try {
            await sendPasswordResetEmail(getAuth(app()), email);
          } catch {
            // same message whether or not the account exists
          }
          setInfo("If this email has an account, a password-reset link has been sent. Check spam too.");
        }}
      >
        Forgot password?
      </Button>
      {error && <Alert tone="red">{error}</Alert>}
      {info && <Alert tone="green">{info}</Alert>}
    </form>
  );
}
