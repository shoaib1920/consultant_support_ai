// Claude adapter: vision extraction of documents + plain-language narrative of eligibility results.
// Model comes from ANTHROPIC_MODEL. Outputs are JSON-schema constrained and Zod-validated.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AiNarrative, Confidence, DocType } from "@/domain/types";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_PROMPT_VERSION,
  NARRATIVE_JSON_SCHEMA,
  NARRATIVE_PROMPT_VERSION,
  extractionSystemPrompt,
  extractionUserPrompt,
  narrativeSystemPrompt,
} from "./prompts";
import { coerceField, looksLikeInjection } from "./sanitize";
import { type AIProvider, type ExtractionOutput, type ExtractionRequest, ExtractionSchema, type NarrativeRequest } from "./types";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

function documentBlock(bytes: Buffer, mimeType: string): BetaContentBlockParam {
  if ((IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return { type: "image", source: { type: "base64", media_type: mimeType as (typeof IMAGE_TYPES)[number], data: bytes.toString("base64") } };
  }
  if (mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } };
  }
  // Plain text: wrapped and labelled as untrusted data.
  return { type: "text", text: `<untrusted_document>\n${bytes.toString("utf8").slice(0, 200_000)}\n</untrusted_document>` };
}

export class ClaudeProvider implements AIProvider {
  readonly name = "claude" as const;
  private client = new Anthropic();

  private async call(system: string, content: BetaContentBlockParam[], schema: Record<string, unknown>): Promise<unknown> {
    let msg: BetaMessage;
    try {
      msg = await this.client.beta.messages
        .stream({
          model: model(),
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          output_config: { effort: "medium", format: { type: "json_schema", schema } },
          messages: [{ role: "user", content }],
        })
        .finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AIError("The AI service is rate-limited. Try again shortly.");
      if (e instanceof Anthropic.AuthenticationError) throw new AIError("ANTHROPIC_API_KEY is invalid.");
      if (e instanceof Anthropic.BadRequestError) throw new AIError(`AI request rejected: ${e.message}`);
      if (e instanceof Anthropic.APIError) throw new AIError(`AI service error (${e.status ?? "network"}).`);
      throw e;
    }
    if (msg.stop_reason === "refusal") throw new AIError("The AI declined to process this document. Enter the fields manually.");
    if (msg.stop_reason === "max_tokens") throw new AIError("Document too long for a single extraction. Split it or enter fields manually.");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError("AI returned malformed output.");
    }
  }

  async extract(req: ExtractionRequest): Promise<ExtractionOutput> {
    const raw = await this.call(
      extractionSystemPrompt(),
      [documentBlock(req.bytes, req.mimeType), { type: "text", text: extractionUserPrompt(req.docType, { fullName: req.student.personal.fullName }) }],
      EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    );
    const parsed = ExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new AIError("AI output failed validation.");
    const p = parsed.data;
    const fields: ExtractionOutput["fields"] = {};
    const fieldConfidence: Record<string, Confidence> = {};
    let injection = p.containsInstructionLikeText;
    for (const f of p.fields) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(f.key)) continue;
      if (looksLikeInjection(f.value)) injection = true;
      fields[f.key] = coerceField(f.key, f.value);
      fieldConfidence[f.key] = f.confidence;
    }
    if (p.totalPagesStated != null) fields.totalPagesStated = p.totalPagesStated;
    if (req.mimeType.startsWith("text/") && looksLikeInjection(req.bytes.toString("utf8"))) injection = true;
    return {
      detectedDocType: p.detectedDocType as DocType,
      pagesDetected: p.pagesDetected,
      legible: p.legible,
      expiryDate: p.expiryDate,
      injectionSuspected: injection,
      fields,
      fieldConfidence,
      transactions: p.transactions.map((t) => ({ ...t, description: t.description.slice(0, 200) })),
      source: "claude",
      model: model(),
      promptVersion: EXTRACTION_PROMPT_VERSION,
    };
  }

  async narrate(req: NarrativeRequest): Promise<AiNarrative> {
    const payload = {
      light: req.result.light,
      score: req.result.score,
      lightReason: req.result.lightReason,
      ruleIssues: req.result.ruleIssues,
      reasons: req.result.reasons.map((r) => ({ id: r.id, category: r.category, severity: r.severity, hardFail: r.hardFail, title: r.title, detail: r.detail, fix: r.fix, insufficientData: r.insufficientData, refs: r.refs.map((x) => x.label) })),
    };
    const raw = await this.call(
      narrativeSystemPrompt(),
      [{ type: "text", text: `<case_summary>\n${req.caseSummary}\n</case_summary>\n<assessment>\n${JSON.stringify(payload)}\n</assessment>\nWrite a 2-3 sentence summary and up to 6 points for a busy processing officer.` }],
      NARRATIVE_JSON_SCHEMA as unknown as Record<string, unknown>,
    );
    const parsed = z
      .object({ summary: z.string().max(2000), points: z.array(z.object({ text: z.string().max(1000), cites: z.array(z.string()), confidence: z.enum(["high", "medium", "low"]) })).max(10) })
      .safeParse(raw);
    if (!parsed.success) throw new AIError("AI narrative failed validation.");
    const ids = new Set(req.result.reasons.map((r) => r.id));
    return {
      summary: parsed.data.summary,
      // drop any point that does not cite a real reason (no unsupported claims)
      points: parsed.data.points.map((p) => ({ ...p, cites: p.cites.filter((c) => ids.has(c)) })).filter((p) => p.cites.length > 0),
      model: model(),
      promptVersion: NARRATIVE_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      source: "claude",
    };
  }
}
