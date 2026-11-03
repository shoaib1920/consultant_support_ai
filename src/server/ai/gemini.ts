// Gemini adapter (Google AI Studio key, works on the free tier). Same prompts, JSON schemas and
// Zod validation as the Claude adapter; called over REST so no extra SDK is needed.
// Model comes from GEMINI_MODEL. Quota protection lives in ./budget.ts, not here.

import type { AiNarrative } from "@/domain/types";
import {
  EXTRACTION_JSON_SCHEMA,
  NARRATIVE_JSON_SCHEMA,
  PROGRAMME_JSON_SCHEMA,
  extractionSystemPrompt,
  extractionUserPrompt,
  narrativeSystemPrompt,
  programmeSystemPrompt,
  programmeUserPrompt,
} from "./prompts";
import { toProgrammeExtraction } from "./sanitize";
import { AIError, narrativePayload, toExtractionOutput, toNarrative } from "./shared";
import { type AIProvider, type ExtractionOutput, type ExtractionRequest, type NarrativeRequest, type ProgrammeExtraction, ProgrammeExtractionSchema, type ProgrammePageRequest } from "./types";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const INLINE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

/** Our JSON schemas -> Gemini's OpenAPI-style response schema (no additionalProperties, nullable instead of type unions). */
export function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    if (k === "type") {
      const types = (Array.isArray(v) ? v : [v]) as string[];
      const real = types.filter((t) => t !== "null");
      out.type = (real[0] ?? "string").toUpperCase();
      if (real.length < types.length) out.nullable = true;
    } else if (k === "properties") out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === "enum") out.enum = (v as unknown[]).filter((e) => e !== null).map(String);
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;

  private async call(system: string, parts: Part[], schema: Record<string, unknown>, opts: { patient?: boolean } = {}): Promise<unknown> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new AIError("GEMINI_API_KEY is not set.");
    const model = geminiModel();
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
        temperature: 0,
        maxOutputTokens: 16384,
        // Flash models think by default; extraction does not need it and it costs quota.
        ...(/^gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    // Free-tier keys answer 429 when a per-minute limit is hit: wait as Google asks and retry,
    // briefly for staff, longer for the nightly job.
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(120_000) });
      } catch {
        throw new AIError("Could not reach the Gemini service.");
      }
      if (res.ok) {
        const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]; promptFeedback?: { blockReason?: string } };
        if (j.promptFeedback?.blockReason) throw new AIError(`Gemini declined this content (${j.promptFeedback.blockReason}). Enter the fields manually.`);
        const c = j.candidates?.[0];
        if (c?.finishReason === "MAX_TOKENS") throw new AIError("Document too long for a single extraction. Split it or enter fields manually.");
        if (c?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(c.finishReason)) throw new AIError(`Gemini stopped early (${c.finishReason}). Enter the fields manually.`);
        const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        try {
          return JSON.parse(text);
        } catch {
          throw new AIError("AI returned malformed output.");
        }
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: { "@type"?: string; retryDelay?: string }[] } };
      const retryable = res.status === 429 || res.status === 500 || res.status === 503;
      const delay = Number(err.error?.details?.find((d) => d.retryDelay)?.retryDelay?.replace("s", "")) || 2 ** attempt * 4;
      if (retryable && attempt < (opts.patient ? 4 : 2) && delay <= (opts.patient ? 65 : 12)) {
        await sleep(delay * 1000);
        continue;
      }
      if (res.status === 429) {
        const daily = /per.?day|PerDay/i.test(err.error?.message ?? "");
        throw new AIError(daily ? "The free Gemini allowance for today is used up. Enter the fields by hand, or try again tomorrow." : "Gemini is busy (free-tier limit). Try again in a minute.");
      }
      if (res.status === 400 && /API key/i.test(err.error?.message ?? "")) throw new AIError("GEMINI_API_KEY is invalid.");
      if (res.status === 403) throw new AIError("GEMINI_API_KEY is not allowed to use this model.");
      if (res.status === 404) throw new AIError(`Gemini model "${model}" was not found. Set GEMINI_MODEL to an available model.`);
      throw new AIError(`AI service error (${res.status}).`);
    }
  }

  async extract(req: ExtractionRequest): Promise<ExtractionOutput> {
    const doc: Part = INLINE_TYPES.includes(req.mimeType)
      ? { inline_data: { mime_type: req.mimeType, data: req.bytes.toString("base64") } }
      : { text: `<untrusted_document>\n${req.bytes.toString("utf8").slice(0, 200_000)}\n</untrusted_document>` };
    const raw = await this.call(extractionSystemPrompt(), [doc, { text: extractionUserPrompt(req.docType, { fullName: req.student.personal.fullName }) }], EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>);
    return toExtractionOutput(raw, req, "gemini", geminiModel());
  }

  async extractProgramme(req: ProgrammePageRequest): Promise<ProgrammeExtraction> {
    const parts: Part[] = req.pages.map((p) =>
      p.kind === "pdf" && p.bytes ? { inline_data: { mime_type: "application/pdf", data: p.bytes.toString("base64") } } : { text: `<untrusted_web_page url="${p.url}">\n${p.text}\n</untrusted_web_page>` },
    );
    const raw = await this.call(programmeSystemPrompt(), [...parts, { text: programmeUserPrompt(req.today) }], PROGRAMME_JSON_SCHEMA as unknown as Record<string, unknown>, { patient: req.background });
    const parsed = ProgrammeExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new AIError("AI output failed validation.");
    return toProgrammeExtraction(parsed.data, req, "gemini", geminiModel());
  }

  async narrate(req: NarrativeRequest): Promise<AiNarrative> {
    const raw = await this.call(narrativeSystemPrompt(), [{ text: narrativePayload(req) }], NARRATIVE_JSON_SCHEMA as unknown as Record<string, unknown>);
    return toNarrative(raw, req, "gemini", geminiModel());
  }
}
