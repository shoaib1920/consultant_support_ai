// Keeps a shared AI key (e.g. Gemini's free tier) inside its quota:
//  - pace: at most AI_PROVIDER_RPM calls per minute across the whole app (staff wait a few seconds or
//    get "busy, try again"; the nightly job simply waits its turn);
//  - daily cap: AI_DAILY_LIMIT calls per UTC day, counted in the datastore so every server instance
//    shares it; the nightly job stops at 60% so staff always keep headroom.
// When the cap is reached, staff are told to enter fields by hand: the app never fails a case over it.

import type { AiNarrative, AiSource } from "@/domain/types";
import { getRepo, nowISO } from "../db";
import { AIError } from "./shared";
import type { AIProvider, ExtractionOutput, ExtractionRequest, NarrativeRequest, ProgrammeExtraction, ProgrammePageRequest } from "./types";

const BACKGROUND_SHARE = 0.6;
const DEFAULTS: Record<AiSource, { rpm: number; daily: number }> = {
  gemini: { rpm: 8, daily: 200 }, // below Google's free-tier limits for Flash models
  claude: { rpm: 40, daily: 0 }, // paid key: pace only (0 = no daily cap)
  mock: { rpm: 0, daily: 0 },
};

export function aiLimits(source: AiSource): { rpm: number; daily: number } {
  const env = (k: string) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : NaN);
  const rpm = env("AI_PROVIDER_RPM"), daily = env("AI_DAILY_LIMIT");
  return { rpm: Number.isFinite(rpm) ? rpm : DEFAULTS[source].rpm, daily: Number.isFinite(daily) ? daily : DEFAULTS[source].daily };
}

const g = globalThis as unknown as { __vgAiCalls?: number[] };
const calls = (g.__vgAiCalls ??= []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pace(rpm: number, background: boolean) {
  if (!rpm) return;
  for (;;) {
    const now = Date.now();
    while (calls.length && now - calls[0] >= 60_000) calls.shift();
    if (calls.length < rpm) {
      calls.push(now);
      return;
    }
    const wait = 60_000 - (now - calls[0]) + 50;
    if (!background && wait > 8_000) throw new AIError(`AI is busy right now (free plan limit). Try again in ${Math.ceil(wait / 1000)} seconds.`);
    await sleep(wait);
  }
}

interface UsageDoc { id: string; organizationId: string; createdAt: string; updatedAt: string; calls: number }

const dayId = () => nowISO().slice(0, 10);

export async function aiUsageToday(): Promise<number> {
  const repo = await getRepo();
  return (await repo.get<UsageDoc>("aiUsage", dayId()))?.calls ?? 0;
}

/** Reserves one call from today's allowance, or explains why not. */
async function reserve(daily: number, background: boolean) {
  if (!daily) return;
  const repo = await getRepo();
  const cap = background ? Math.floor(daily * BACKGROUND_SHARE) : daily;
  await repo.transaction(async (tx) => {
    const id = dayId();
    const now = nowISO();
    const doc = (await tx.get<UsageDoc>("aiUsage", id)) ?? { id, organizationId: "_system", createdAt: now, updatedAt: now, calls: 0 };
    if (doc.calls >= cap)
      throw new AIError(background ? "Nightly check paused: today's AI allowance is kept for staff." : "Today's AI allowance is used up. Enter the fields by hand, or try again tomorrow.");
    await tx.set("aiUsage", id, { ...doc, calls: doc.calls + 1, updatedAt: now });
  });
}

export class BudgetedProvider implements AIProvider {
  readonly name: AiSource;
  constructor(private inner: AIProvider) {
    this.name = inner.name;
  }
  private async guard<T>(background: boolean, fn: () => Promise<T>): Promise<T> {
    const { rpm, daily } = aiLimits(this.name);
    await reserve(daily, background);
    await pace(rpm, background);
    return fn();
  }
  extract(req: ExtractionRequest): Promise<ExtractionOutput> {
    return this.guard(false, () => this.inner.extract(req));
  }
  narrate(req: NarrativeRequest): Promise<AiNarrative> {
    return this.guard(false, () => this.inner.narrate(req));
  }
  extractProgramme(req: ProgrammePageRequest): Promise<ProgrammeExtraction> {
    return this.guard(!!req.background, () => this.inner.extractProgramme(req));
  }
}
