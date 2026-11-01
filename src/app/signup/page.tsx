import { CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Disclaimer } from "@/components/app-shell";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { TRIAL_DAYS } from "@/domain/trial";
import { getActor } from "@/server/auth/session";
import { firebaseConfigured } from "@/server/db";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Start your free trial" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INCLUDED = [
  "Refusal-risk screening for UK, Germany, Italy and France",
  "28-day bank-statement checks and funds calculations",
  "Two-person approval before any non-refundable payment",
  "Student portal, secure intake links and a tamper-evident audit log",
];

export default async function SignupPage() {
  if (await getActor()) redirect("/");
  const available = firebaseConfigured() && !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  // a demo-only deployment can send prospects to the live app's sign-up page
  const elsewhere = process.env.SIGNUP_URL;
  if (!available && elsewhere) redirect(elsewhere);
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 p-4 py-10 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-7 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">VisaGuard</h1>
              <p className="text-sm text-muted-foreground">Case management and refusal-risk screening for study-visa consultancies.</p>
            </div>
          </div>
          <div>
            <Badge tone="green">{TRIAL_DAYS}-day free trial</Badge>
            <h2 className="mt-3 text-xl font-semibold">Try VisaGuard free for {TRIAL_DAYS} days</h2>
            <p className="mt-1 text-sm text-muted-foreground">Full access for your whole team. No card required. Your data stays yours, and is kept if you decide to upgrade after the trial.</p>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {INCLUDED.map((i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" /> {i}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Your workspace starts with our reference rules marked Unverified. A manager checks each against the official source before any case can turn green.</p>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Create your consultancy account</CardTitle>
            <CardDescription>Takes about a minute.</CardDescription>
          </CardHeader>
          <CardContent>
            {available ? (
              <SignupForm />
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">Self-service sign-up is not switched on for this deployment.</p>
                <p>
                  <Link href="/login" className="text-primary underline">
                    Back to sign in
                  </Link>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
