import { ShieldCheck } from "lucide-react";
import type { User } from "@/domain/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Disclaimer } from "@/components/app-shell";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { demoLoginAction } from "@/server/actions";
import { ROLE_LABELS } from "@/server/auth/rbac";
import { demoMode } from "@/server/auth/session";
import { firebaseConfigured, getRepo } from "@/server/db";
import { ensureSeeded } from "@/server/seed";
import { FirebaseLogin } from "./firebase-login";

export const maxDuration = 300;
export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const demo = demoMode();
  let users: User[] = [];
  if (demo) {
    await ensureSeeded();
    users = (await (await getRepo()).list<User>("users", [["organizationId", "==", "org_demo"]])).filter((u) => u.active);
  }
  const staff = users.filter((u) => u.role !== "student");
  const students = users.filter((u) => u.role === "student");
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 py-10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">VisaGuard</h1>
            <p className="text-sm text-muted-foreground">Nothing irreversible happens until the verification gates pass.</p>
          </div>
        </div>
        {firebaseConfigured() && process.env.NEXT_PUBLIC_FIREBASE_API_KEY && (
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Use your consultancy account.</CardDescription>
            </CardHeader>
            <CardContent>
              <FirebaseLogin />
            </CardContent>
          </Card>
        )}
        {demo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Demo sign-in <Badge tone="amber">Mock auth</Badge>
              </CardTitle>
              <CardDescription>Pick a role. Each role sees only what it is allowed to (enforced on the server and in Firestore rules).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Staff</div>
                <div className="flex flex-col gap-2">
                  {staff.map((u) => (
                    <ActionForm key={u.id} action={demoLoginAction}>
                      <input type="hidden" name="uid" value={u.id} />
                      <SubmitButton variant="outline" className="h-auto justify-between py-2" pendingText="Signing in…">
                        <span className="text-left">
                          <span className="block font-medium">{u.name}</span>
                          <span className="block text-xs text-muted-foreground">{u.email}</span>
                        </span>
                        <Badge tone="blue">{ROLE_LABELS[u.role]}</Badge>
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Student portal</div>
                <div className="flex flex-col gap-2">
                  {students.map((u) => (
                    <ActionForm key={u.id} action={demoLoginAction}>
                      <input type="hidden" name="uid" value={u.id} />
                      <SubmitButton variant="outline" className="h-auto justify-between py-2" pendingText="Signing in…">
                        <span className="text-left">
                          <span className="block font-medium">{u.name}</span>
                          <span className="block text-xs text-muted-foreground">{u.email}</span>
                        </span>
                        <Badge>Student</Badge>
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Secure intake link demo: <a className="text-primary underline" href="/intake/demo-intake-link-saad-khan-2026">/intake/demo-intake-link-saad-khan-2026</a>
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {!demo && !firebaseConfigured() && <p className="text-sm text-red">No authentication provider configured. Set Firebase env vars or DEMO_MODE=true.</p>}
      </div>
      <Disclaimer />
    </div>
  );
}
