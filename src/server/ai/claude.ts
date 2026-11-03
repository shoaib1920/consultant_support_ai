// Claude adapter: vision extraction of documents + plain-language narrative of eligibility results.
// Model comes from ANTHROPIC_MODEL. Outputs are JSON-schema constrained and Zod-validated.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
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

export { AIError } from "./shared";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

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
    return toExtractionOutput(raw, req, "claude", model());
  }

  async extractProgramme(req: ProgrammePageRequest): Promise<ProgrammeExtraction> {
    const blocks: BetaContentBlockParam[] = req.pages.map((p) =>
      p.kind === "pdf" && p.bytes
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.bytes.toString("base64") }, title: p.url }
        : { type: "text", text: `<untrusted_web_page url="${p.url}">\n${p.text}\n</untrusted_web_page>` },
    );
    const raw = await this.call(programmeSystemPrompt(), [...blocks, { type: "text", text: programmeUserPrompt(req.today) }], PROGRAMME_JSON_SCHEMA as unknown as Record<string, unknown>);
    const parsed = ProgrammeExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new AIError("AI output failed validation.");
    return toProgrammeExtraction(parsed.data, req, "claude", model());
  }

  async narrate(req: NarrativeRequest): Promise<AiNarrative> {
    const raw = await this.call(narrativeSystemPrompt(), [{ type: "text", text: narrativePayload(req) }], NARRATIVE_JSON_SCHEMA as unknown as Record<string, unknown>);
    return toNarrative(raw, req, "claude", model());
  }
}
