// Gemini adapter (free API key) and the quota guard that keeps a shared key inside its limits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiProviderLabel, getAI, setAI, type AIProvider } from "@/server/ai";
import { BudgetedProvider } from "@/server/ai/budget";
import { GeminiProvider, toGeminiSchema } from "@/server/ai/gemini";
import { MockProvider } from "@/server/ai/mock";
import { PROGRAMME_JSON_SCHEMA } from "@/server/ai/prompts";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { focusPage } from "@/server/web/official-page";

const env = { ...process.env };
const page = { url: "https://www.example.ac.uk/msc", kind: "html" as const, text: "MSc Data Science\nIELTS 6.5 overall.\nInternational fee £18,500 per year." };
const reply = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
const programmeJson = { isProgrammePage: true, containsInstructionLikeText: false, country: "UK", notes: [], fields: [{ key: "ielts", value: "6.5", quote: "IELTS 6.5 overall.", confidence: "high" }] };

beforeEach(() => {
  setRepo(new MemoryRepo());
  (globalThis as { __vgAiCalls?: number[] }).__vgAiCalls?.splice(0);
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_DAILY_LIMIT;
  delete process.env.AI_PROVIDER_RPM;
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
  setAI(undefined as unknown as AIProvider);
});

describe("Gemini adapter", () => {
  it("is chosen when only a Gemini key is set", () => {
    setAI(undefined as unknown as AIProvider);
    expect(getAI().name).toBe("gemini");
    expect(aiProviderLabel()).toBe("Gemini (gemini-2.5-flash)");
  });

  it("translates our JSON schema into Gemini's format", () => {
    const s = toGeminiSchema(PROGRAMME_JSON_SCHEMA) as { type: string; properties: Record<string, { type: string; nullable?: boolean; items?: { properties: Record<string, unknown> } }> };
    expect(s.type).toBe("OBJECT");
    expect(s.properties.country).toEqual({ type: "STRING", nullable: true });
    expect(JSON.stringify(s)).not.toContain("additionalProperties");
    expect(s.properties.fields.items!.properties.key).toMatchObject({ type: "STRING" });
  });

  it("reads a programme page and labels the result as Gemini", async () => {
    const fetchMock = vi.fn(async () => reply(programmeJson));
    vi.stubGlobal("fetch", fetchMock);
    const out = await new GeminiProvider().extractProgramme({ pages: [page], today: "2026-11-04" });
    expect(out).toMatchObject({ source: "gemini", model: "gemini-2.5-flash", country: "UK", fields: { ielts: { value: "6.5" } } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string).generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("says plainly when the free daily allowance is used up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, per day", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" }] } }), { status: 429 })));
    await expect(new GeminiProvider().extractProgramme({ pages: [page], today: "2026-11-04" })).rejects.toThrow(/allowance for today is used up/);
  });

  it("retries a short per-minute limit instead of failing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "per minute", details: [{ retryDelay: "2s" }] } }), { status: 429 }))
      .mockResolvedValueOnce(reply(programmeJson));
    vi.stubGlobal("fetch", fetchMock);
    const p = new GeminiProvider().extractProgramme({ pages: [page], today: "2026-11-04" });
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toMatchObject({ source: "gemini" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("quota guard", () => {
  class Counting extends MockProvider {
    override readonly name = "gemini" as unknown as "mock";
    n = 0;
    override async extractProgramme(req: Parameters<MockProvider["extractProgramme"]>[0]) {
      this.n++;
      return super.extractProgramme(req);
    }
  }

  it("stops at the daily cap and keeps 40% of the day for staff", async () => {
    process.env.AI_DAILY_LIMIT = "5";
    process.env.AI_PROVIDER_RPM = "0";
    const inner = new Counting();
    const ai = new BudgetedProvider(inner as unknown as AIProvider);
    const req = { pages: [page], today: "2026-11-04" };
    for (let i = 0; i < 3; i++) await ai.extractProgramme({ ...req, background: true });
    await expect(ai.extractProgramme({ ...req, background: true })).rejects.toThrow(/kept for staff/);
    await ai.extractProgramme(req);
    await ai.extractProgramme(req);
    await expect(ai.extractProgramme(req)).rejects.toThrow(/allowance is used up/);
    expect(inner.n).toBe(5); // refused calls never reach the provider
  });

  it("paces calls per minute: staff get 'busy' instead of a provider error", async () => {
    process.env.AI_DAILY_LIMIT = "0";
    process.env.AI_PROVIDER_RPM = "2";
    const ai = new BudgetedProvider(new Counting() as unknown as AIProvider);
    const req = { pages: [page], today: "2026-11-04" };
    await ai.extractProgramme(req);
    await ai.extractProgramme(req);
    await expect(ai.extractProgramme(req)).rejects.toThrow(/busy right now/);
  });

  it("sends only the useful part of a long page", () => {
    const filler = Array.from({ length: 4000 }, (_, i) => `Campus news item ${i} about sports and clubs.`).join("\n");
    const long = { ...page, text: `MSc Data Science\n${filler}\nEntry requirements: IELTS 6.5 overall\n${filler}` };
    const f = focusPage(long);
    expect(f.text.length).toBeLessThanOrEqual(30_000);
    expect(f.text).toContain("Entry requirements: IELTS 6.5 overall");
    expect(f.text.startsWith("MSc Data Science")).toBe(true);
  });
});
