// Defensive handling of text that originated from uploaded documents.

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
