import { AIError, ClaudeProvider } from "./claude";
import { MockProvider } from "./mock";
import type { AIProvider, ExtractionOutput, ExtractionRequest, NarrativeRequest } from "./types";

export * from "./types";
export { AIError } from "./claude";
export { RateLimitError, checkRateLimit } from "./ratelimit";

const g = globalThis as unknown as { __vgAI?: AIProvider };

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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
}

export function getAI(): AIProvider {
  if (g.__vgAI) return g.__vgAI;
  if (aiConfigured()) return (g.__vgAI = new ClaudeProvider());
  return (g.__vgAI = process.env.DEMO_MODE === "true" || process.env.NODE_ENV !== "production" ? new MockProvider() : new ManualEntryProvider());
}

export function setAI(p: AIProvider) {
  g.__vgAI = p;
}
