// Post-processing shared by every real AI provider (Claude, Gemini): the model's JSON is validated
// with Zod and cleaned the same way whichever model produced it.

import { z } from "zod";
import type { AiNarrative, AiSource, Confidence, DocType } from "@/domain/types";
import { EXTRACTION_PROMPT_VERSION, NARRATIVE_PROMPT_VERSION } from "./prompts";
import { coerceField, looksLikeInjection } from "./sanitize";
import { type ExtractionOutput, type ExtractionRequest, ExtractionSchema, type NarrativeRequest } from "./types";

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}

export function toExtractionOutput(raw: unknown, req: ExtractionRequest, source: AiSource, model: string): ExtractionOutput {
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
    source,
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
  };
}

export function narrativePayload(req: NarrativeRequest): string {
  const payload = {
    light: req.result.light,
    score: req.result.score,
    lightReason: req.result.lightReason,
    ruleIssues: req.result.ruleIssues,
    reasons: req.result.reasons.map((r) => ({ id: r.id, category: r.category, severity: r.severity, hardFail: r.hardFail, title: r.title, detail: r.detail, fix: r.fix, insufficientData: r.insufficientData, refs: r.refs.map((x) => x.label) })),
  };
  return `<case_summary>\n${req.caseSummary}\n</case_summary>\n<assessment>\n${JSON.stringify(payload)}\n</assessment>\nWrite a 2-3 sentence summary and up to 6 points for a busy processing officer.`;
}

export function toNarrative(raw: unknown, req: NarrativeRequest, source: AiSource, model: string): AiNarrative {
  const parsed = z
    .object({ summary: z.string().max(2000), points: z.array(z.object({ text: z.string().max(1000), cites: z.array(z.string()), confidence: z.enum(["high", "medium", "low"]) })).max(10) })
    .safeParse(raw);
  if (!parsed.success) throw new AIError("AI narrative failed validation.");
  const ids = new Set(req.result.reasons.map((r) => r.id));
  return {
    summary: parsed.data.summary,
    // drop any point that does not cite a real reason (no unsupported claims)
    points: parsed.data.points.map((p) => ({ ...p, cites: p.cites.filter((c) => ids.has(c)) })).filter((p) => p.cites.length > 0),
    model,
    promptVersion: NARRATIVE_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    source,
  };
}
