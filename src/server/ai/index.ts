import { ClaudeProvider } from "./claude";
import { MockProvider } from "./mock";
import type { AIProvider } from "./types";

export * from "./types";
export { AIError } from "./claude";
export { RateLimitError, checkRateLimit } from "./ratelimit";

const g = globalThis as unknown as { __vgAI?: AIProvider };

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getAI(): AIProvider {
  return (g.__vgAI ??= aiConfigured() ? new ClaudeProvider() : new MockProvider());
}

export function setAI(p: AIProvider) {
  g.__vgAI = p;
}
