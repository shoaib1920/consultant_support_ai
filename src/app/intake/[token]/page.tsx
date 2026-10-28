import { ShieldCheck } from "lucide-react";
import { Disclaimer } from "@/components/app-shell";
import { ProfileEditor } from "@/components/profile-editor";
import { Alert } from "@/components/ui/primitives";
import { saveIntakeAction } from "@/server/actions";
import { getRepo } from "@/server/db";
import { ensureSeeded } from "@/server/seed";
import { CONSENT_TEXT, studentByIntakeToken } from "@/server/services/students";

export const metadata = { title: "Secure intake", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await ensureSeeded();
  const s = await studentByIntakeToken(await getRepo(), token);
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-2 border-b px-4 font-semibold"><ShieldCheck className="size-4 text-primary" /> VisaGuard secure intake</header>
      <main className="mx-auto max-w-4xl p-4">
        {!s ? (
          <Alert tone="red" title="This link is invalid or has expired">Ask your consultant for a new secure link.</Alert>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">Fill in your details accurately — exactly as they appear on your passport and certificates. Your information is sent securely to your consultancy only.</p>
            <ProfileEditor student={{ ...s, internalNotes: undefined }} save={saveIntakeAction.bind(null, token)} mode="intake" consentText={CONSENT_TEXT} />
          </>
        )}
      </main>
      <Disclaimer />
    </div>
  );
}
