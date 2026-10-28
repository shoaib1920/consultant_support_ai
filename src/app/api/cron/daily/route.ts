// Daily sweep (Vercel Cron, see vercel.json): re-assess every open case so rule staleness (60 days)
// and deadlines are reflected in lights, tasks and notifications even when nobody opens the case.
// Replaces the Cloud Function `dailySweep`, which needs the Firebase Blaze plan.
import { NextResponse, type NextRequest } from "next/server";
import type { Case } from "@/domain/types";
import { safeEqual } from "@/server/crypto";
import { getRepo } from "@/server/db";
import { recomputeEligibility } from "@/server/services/eligibility";
import { syncTasks } from "@/server/services/tasks";

export const maxDuration = 300;
const BUDGET_MS = 240_000; // stop early and continue tomorrow rather than time out mid-case

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(got, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const repo = await getRepo();
  // least recently updated first, so a partial run still covers the most out-of-date cases
  const cases = (await repo.list<Case>("cases")).filter((c) => c.stage !== "Decision" && c.stage !== "Pre-departure").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  let done = 0;
  const failed: string[] = [];
  for (const c of cases) {
    if (Date.now() - started > BUDGET_MS) break;
    const sys = { id: "system" as const, name: "System" as const, role: "system" as const, organizationId: c.organizationId };
    try {
      await recomputeEligibility(repo, sys, c.id);
      await syncTasks(repo, sys, c.id);
      done++;
    } catch (e) {
      failed.push(c.id);
      console.error("daily sweep failed for", c.id, e);
    }
  }
  return NextResponse.json({ ok: true, open: cases.length, reassessed: done, failed, seconds: Math.round((Date.now() - started) / 1000) });
}
