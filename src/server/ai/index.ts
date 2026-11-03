import { ClaudeProvider } from "./claude";
import { isDemoMode } from "../config-check";
import { BudgetedProvider, aiLimits } from "./budget";
import { GeminiProvider, geminiModel } from "./gemini";
import { MockProvider } from "./mock";
import { AIError } from "./shared";
import type { AIProvider, ExtractionOutput, ExtractionRequest, NarrativeRequest, ProgrammeExtraction, ProgrammePageRequest } from "./types";

export * from "./types";
export { AIError } from "./shared";
export { RateLimitError, checkRateLimit } from "./ratelimit";
export { aiLimits, aiUsageToday } from "./budget";

const g = globalThis as unknown as { __vgAI?: AIProvider };

/** Which real AI to use: AI_PROVIDER if set, otherwise Claude when its key exists, then Gemini. */
export function aiProvider(): "claude" | "gemini" | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export function aiConfigured(): boolean {
  return aiProvider() !== null;
}

/** e.g. "Gemini (gemini-2.5-flash)" for settings, health and labels. */
export function aiProviderLabel(): string {
  const p = aiProvider();
  if (p === "claude") return `Claude (${process.env.ANTHROPIC_MODEL || "claude-opus-5-5"})`;
  if (p === "gemini") return `Gemini (${geminiModel()})`;
  return "Mock AI";
}

/**
 * Live mode without an API key. The demo MockProvider derives "extracted" fields from the student's own
 * profile, which would make every consistency check pass on documents nobody read. With real clients,
 * extraction must fail honestly so staff enter the key fields by hand. Explanations stay template-based.
 */
class ManualEntryProvider implements AIProvider {
  readonly name = "mock" as const;
  private narrator = new MockProvider();
  async extract(_req: ExtractionRequest): Promise<ExtractionOutput> {
    throw new AIError("AI document reading is not switched on for this account.");
  }
  narrate(req: NarrativeRequest) {
    return this.narrator.narrate(req);
  }
  async extractProgramme(_req: ProgrammePageRequest): Promise<ProgrammeExtraction> {
    throw new AIError("Reading official university pages needs AI switched on for this account (GEMINI_API_KEY or ANTHROPIC_API_KEY).");
  }
}

export function getAI(): AIProvider {
  if (g.__vgAI) return g.__vgAI;
  const p = aiProvider();
  if (p === "claude") return (g.__vgAI = new BudgetedProvider(new ClaudeProvider()));
  if (p === "gemini") return (g.__vgAI = new BudgetedProvider(new GeminiProvider()));
  return (g.__vgAI = isDemoMode() || process.env.NODE_ENV !== "production" ? new MockProvider() : new ManualEntryProvider());
}

export function setAI(p: AIProvider) {
  g.__vgAI = p;
}

/** For the settings page: today's usage against the daily cap of the active provider. */
export function aiDailyLimit(): number {
  const p = aiProvider();
  return p ? aiLimits(p).daily : 0;
}
