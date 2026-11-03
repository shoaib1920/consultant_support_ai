import { NextResponse } from "next/server";
import { aiConfigured, aiProviderLabel } from "@/server/ai";
import { configProblems, isDemoMode } from "@/server/config-check";
import { firebaseConfigured } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  const problems = configProblems();
  return NextResponse.json({
    ok: true,
    mode: isDemoMode() ? "demo" : "live",
    datastore: firebaseConfigured() ? "firestore" : "mock",
    ai: aiConfigured() ? aiProviderLabel() : isDemoMode() ? "mock" : "off (staff enter document fields by hand)",
    nightlyJob: process.env.CRON_SECRET ? "configured" : "CRON_SECRET not set",
    missingSettings: problems,
  });
}
