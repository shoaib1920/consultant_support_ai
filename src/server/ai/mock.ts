// MOCK AI adapter (used when ANTHROPIC_API_KEY is not set).
// Behaves realistically: derives fields from the student profile so consistency checks run,
// honours a JSON sidecar format so testers can simulate discrepancies, and detects
// instruction-like text in plain-text uploads. Every output is labelled source:"mock".

import { addDays } from "@/domain/dates";
import type { AiNarrative, Confidence, DocType, Student } from "@/domain/types";
import { EXTRACTION_PROMPT_VERSION, NARRATIVE_PROMPT_VERSION } from "./prompts";
import { coerceField, looksLikeInjection } from "./sanitize";
import type { AIProvider, ExtractionOutput, ExtractionRequest, NarrativeRequest } from "./types";

const MOCK_MODEL = "mock-extractor-1";

function fromProfile(docType: DocType, s: Student): Record<string, string | number | null> {
  const p = s.personal;
  const edu = (lv: string[]) => s.education.find((e) => lv.includes(e.level));
  switch (docType) {
    case "passport":
      return { fullName: p.fullName, surname: p.surname ?? null, givenNames: p.givenNames ?? null, passportNumber: p.passportNumber ?? null, dob: p.dob ?? null, nationality: "PAKISTANI", expiryDate: p.passportExpiry ?? null, fatherName: p.fatherName ?? null };
    case "cnic":
      return { fullName: p.fullName, fatherName: p.fatherName ?? null, cnic: p.cnic ?? null, dob: p.dob ?? null };
    case "matric":
    case "intermediate": {
      const e = edu(docType === "matric" ? ["matric", "o_level"] : ["intermediate", "a_level"]);
      return { fullName: p.fullName, fatherName: p.fatherName ?? null, institution: e?.board ?? e?.institution ?? null, obtained: e?.obtained ?? null, total: e?.total ?? null, year: e?.endDate?.slice(0, 4) ?? null };
    }
    case "degree":
    case "transcript": {
      const e = edu(["bachelor"]);
      return { fullName: p.fullName, institution: e?.institution ?? null, program: e?.program ?? null, cgpa: e?.gradeType === "cgpa" ? e?.obtained ?? null : null, scale: e?.total ?? null, completionDate: e?.endDate ?? null };
    }
    case "english_test": {
      const t = s.englishTests[0];
      return { fullName: p.fullName, testType: t?.type ?? null, overall: t?.overall ?? null, listening: t?.listening ?? null, reading: t?.reading ?? null, writing: t?.writing ?? null, speaking: t?.speaking ?? null, testDate: t?.testDate ?? null, passportNumber: p.passportNumber ?? null };
    }
    case "bank_statement":
      return { accountHolder: s.sponsors[0]?.name ?? p.fullName, bankName: "Sample Bank Ltd", currency: "PKR" };
    case "sponsor_letter":
      return { sponsorName: s.sponsors[0]?.name ?? null, relation: s.sponsors[0]?.relation ?? null, studentName: p.fullName };
    case "sop":
      return { fullName: p.fullName, wordCount: 950 };
    default:
      return { fullName: p.fullName };
  }
}

export class MockProvider implements AIProvider {
  readonly name = "mock" as const;

  async extract(req: ExtractionRequest): Promise<ExtractionOutput> {
    let fields: ExtractionOutput["fields"] = fromProfile(req.docType, req.student);
    let transactions: ExtractionOutput["transactions"] = [];
    let detected: DocType = req.docType;
    let pages = req.mimeType === "application/pdf" ? Math.max(1, (req.bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length) : 1;
    let legible = true;
    let injection = false;

    // JSON sidecar: {"fields": {...}, "transactions": [...], "detectedDocType": "...", "pagesDetected": n, "legible": bool}
    if (req.mimeType === "application/json" || req.fileName.endsWith(".json")) {
      try {
        const j = JSON.parse(req.bytes.toString("utf8"));
        if (j.fields && typeof j.fields === "object") {
          fields = { ...fields };
          for (const [k, v] of Object.entries(j.fields)) {
            if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(k)) continue;
            if (typeof v === "string" && looksLikeInjection(v)) injection = true;
            fields[k] = typeof v === "number" || typeof v === "boolean" || v === null ? (v as number | boolean | null) : coerceField(k, String(v));
          }
        }
        if (Array.isArray(j.transactions)) transactions = j.transactions.slice(0, 2000);
        if (typeof j.detectedDocType === "string") detected = j.detectedDocType as DocType;
        if (typeof j.pagesDetected === "number") pages = j.pagesDetected;
        if (typeof j.legible === "boolean") legible = j.legible;
      } catch {
        legible = false;
      }
    } else if (req.mimeType.startsWith("text/")) {
      injection = looksLikeInjection(req.bytes.toString("utf8"));
    }

    const fieldConfidence: Record<string, Confidence> = {};
    for (const k of Object.keys(fields)) fieldConfidence[k] = fields[k] == null ? "low" : "medium";
    const expiry = (fields.expiryDate as string | null) ?? (req.docType === "english_test" && fields.testDate ? addDays(String(fields.testDate), 730) : null);
    return {
      detectedDocType: detected,
      pagesDetected: pages,
      legible,
      expiryDate: expiry,
      injectionSuspected: injection,
      fields,
      fieldConfidence,
      transactions,
      source: "mock",
      model: MOCK_MODEL,
      promptVersion: EXTRACTION_PROMPT_VERSION,
    };
  }

  async narrate(req: NarrativeRequest): Promise<AiNarrative> {
    const r = req.result;
    const top = r.reasons.filter((x) => x.severity !== "info").slice(0, 5);
    const lead =
      r.light === "RED"
        ? `This case is RED: ${r.lightReason}. Do not pay any non-refundable fee or submit until the blocking items are resolved or a manager formally overrides with the student's signed acknowledgment.`
        : r.light === "AMBER"
          ? `This case is AMBER (${r.lightReason}). It can only move forward once the items below are reviewed by staff${r.ruleIssues.length ? " and the flagged rules are verified by a manager" : ""}.`
          : "This case is GREEN on verified rules. Continue with normal checks; GREEN is not a guarantee of admission or visa approval.";
    return {
      summary: `${lead} (Mock AI narrative — generated from the deterministic result without calling Claude.)`,
      points: top.map((x) => ({
        text: `${x.title}. ${x.insufficientData ? "Insufficient data — collect it rather than assume. " : ""}${x.fix ?? ""}`.trim(),
        cites: [x.id],
        confidence: x.confidence,
      })),
      model: "mock-narrator-1",
      promptVersion: NARRATIVE_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      source: "mock",
    };
  }
}

