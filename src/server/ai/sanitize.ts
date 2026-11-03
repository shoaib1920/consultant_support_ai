// Defensive handling of text that originated from uploaded documents and official web pages.

import type { z } from "zod";
import { type AiSource, type CountryCode, PROGRAMME_SOURCE_FIELDS, type ProgrammeSourceField } from "@/domain/types";
import { PROGRAMME_PROMPT_VERSION } from "./prompts";
import type { ProgrammeExtraction, ProgrammeExtractionSchema, ProgrammePageRequest } from "./types";

/** Keeps only known fields, cleans values and quotes, and flags instruction-like text from the page. */
export function toProgrammeExtraction(raw: z.infer<typeof ProgrammeExtractionSchema>, req: ProgrammePageRequest, source: AiSource, model: string): ProgrammeExtraction {
  const fields: ProgrammeExtraction["fields"] = {};
  let injection = raw.containsInstructionLikeText || req.pages.some((p) => looksLikeInjection(p.text));
  for (const f of raw.fields) {
    if (!(PROGRAMME_SOURCE_FIELDS as readonly string[]).includes(f.key)) continue;
    if (looksLikeInjection(f.value) || looksLikeInjection(f.quote)) injection = true;
    const value = sanitizeValue(f.value, 200);
    if (!value) continue;
    fields[f.key as ProgrammeSourceField] = { value, quote: sanitizeValue(f.quote, 300), confidence: f.confidence };
  }
  const country = (["UK", "DE", "IT", "FR"] as const).find((c) => c === raw.country?.toUpperCase()) ?? null;
  return {
    isProgrammePage: raw.isProgrammePage,
    injectionSuspected: injection,
    country: country as CountryCode | null,
    fields,
    notes: raw.notes.map((n) => sanitizeValue(n, 300)).filter(Boolean),
    source,
    model,
    promptVersion: PROGRAMME_PROMPT_VERSION,
  };
}

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are (now )?(an?|the) (ai|assistant|model)/i,
  /system prompt/i,
  /(mark|set) (this|the) (document|case|applicant) (as )?(verified|approved|green)/i,
  /approve (this|the) (applicant|student|case|visa)/i,
  /<\/?(system|assistant|instructions?)>/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

/** Strip control characters / markup and cap length. Values are data; they are never executed or used as prompts. */
export function sanitizeValue(v: string, max = 500): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]{0,200}>/g, "")
    .trim()
    .slice(0, max);
}

const NUMERIC_KEYS = new Set(["obtained", "total", "cgpa", "scale", "overall", "listening", "reading", "writing", "speaking", "tuitionFee", "tuitionPaid", "openingBalance", "closingBalance", "amountPledged", "annualIncome", "amount", "monthlyRelease", "wordCount", "backlogs", "totalPagesStated", "yearsExperience"]);

export function coerceField(key: string, value: string): string | number | null {
  const clean = sanitizeValue(value);
  if (!clean) return null;
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(clean.replace(/[,\s]/g, "").replace(/^(PKR|Rs\.?|GBP|EUR|£|€)/i, ""));
    return Number.isFinite(n) ? n : clean;
  }
  return clean;
}
