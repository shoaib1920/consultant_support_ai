// MOCK AI adapter (used when ANTHROPIC_API_KEY is not set).
// Behaves realistically: derives fields from the student profile so consistency checks run,
// honours a JSON sidecar format so testers can simulate discrepancies, and detects
// instruction-like text in plain-text uploads. Every output is labelled source:"mock".

import { addDays } from "@/domain/dates";
import type { AiNarrative, Confidence, DocType, Student } from "@/domain/types";
import { EXTRACTION_PROMPT_VERSION, NARRATIVE_PROMPT_VERSION } from "./prompts";
import { coerceField, looksLikeInjection, toProgrammeExtraction } from "./sanitize";
import type { AIProvider, ExtractionOutput, ExtractionRequest, NarrativeRequest, ProgrammeExtraction, ProgrammePageRequest } from "./types";

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

  /** Pattern-based stand-in for Claude: finds the common requirement phrasings on a programme page. */
  async extractProgramme(req: ProgrammePageRequest): Promise<ProgrammeExtraction> {
    const text = req.pages.map((p) => [p.title ?? "", p.text].join("\n")).join("\n\n");
    const fields: { key: string; value: string; quote: string; confidence: Confidence }[] = [];
    const notes: string[] = ["Read by the Mock AI (pattern matching, no Claude key). Check every value against the page."];
    const sentence = (i: number) => {
      const start = Math.max(text.lastIndexOf("\n", i), text.lastIndexOf(". ", i) + 1, 0);
      const ends = [text.indexOf("\n", i), text.indexOf(". ", i)].filter((x) => x > 0);
      return text.slice(start, ends.length ? Math.min(...ends) + 1 : i + 160).trim().slice(0, 220);
    };
    const find = (key: string, re: RegExp, pick: (m: RegExpExecArray) => string | null, confidence: Confidence = "medium") => {
      const m = re.exec(text);
      const v = m && pick(m);
      if (m && v) fields.push({ key, value: v, quote: sentence(m.index), confidence });
    };
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const isoFrom = (d: string, mon: string, y: string) => `${y}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;

    const title = req.pages[0]?.title ?? "";
    const parts = title.split(/\s[|\-–—]\s/).map((s) => s.trim()).filter(Boolean);
    const uni = parts.find((s) => /universit|college|politecnico|hochschule|école|ecole|school of/i.test(s));
    if (uni) fields.push({ key: "universityName", value: uni, quote: title, confidence: "medium" });
    const prog = parts.find((s) => s !== uni && /\b(MSc|MA|MBA|MEng|MRes|LLM|BSc|BA|BEng|PhD|Master|Bachelor|Laurea|Foundation)\b/i.test(s));
    if (prog) fields.push({ key: "name", value: prog, quote: title, confidence: "medium" });
    const lvl = /\b(PhD|Doctor)/i.test(prog ?? text) ? "phd" : /\b(MSc|MA|MBA|MEng|MRes|LLM|Master|Laurea Magistrale)\b/i.test(prog ?? text) ? "master" : /\b(BSc|BA|BEng|Bachelor)\b/i.test(prog ?? text) ? "bachelor" : /\bFoundation\b/i.test(prog ?? text) ? "foundation" : null;
    if (lvl) fields.push({ key: "level", value: lvl, quote: prog ?? title, confidence: "low" });

    find("ielts", /IELTS[^0-9\n]{0,60}?(\d(?:\.\d)?)\b/i, (m) => (Number(m[1]) >= 4 && Number(m[1]) <= 9 ? m[1] : null));
    find("pte", /PTE[^0-9\n]{0,60}?(\d{2})\b/i, (m) => m[1]);
    find("duolingo", /Duolingo[^0-9\n]{0,60}?(\d{2,3})\b/i, (m) => m[1]);
    find("minCGPA4", /(?:CGPA|GPA)[^0-9\n]{0,40}?(\d\.\d{1,2})\s*(?:\/|out of)\s*4(?:\.0+)?\b/i, (m) => m[1]);
    find("moiAccepted", /medium of instruction|\bMOI\b/i, () => "true", "low");
    find("germanLevel", /German[^.\n]{0,40}\b(A1|A2|B1|B2|C1|C2)\b/i, (m) => m[1]);
    find("tuitionPerYear", /(?:international|overseas)[^£€$\n]{0,80}([£€$])\s?([\d,]{4,7})/i, (m) => m[2].replace(/,/g, ""));
    const cur = /(?:international|overseas)[^£€$\n]{0,80}([£€$])/i.exec(text)?.[1];
    if (cur) fields.push({ key: "currency", value: cur === "£" ? "GBP" : cur === "€" ? "EUR" : "USD", quote: cur, confidence: "medium" });
    find("durationMonths", /\b(\d{1,2}|one|two|three|four)\s+(year|month)s?\b[^.\n]{0,20}full[- ]time/i, (m) => {
      const n = { one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase() as "one"] ?? Number(m[1]);
      return String(m[2].toLowerCase() === "year" ? n * 12 : n);
    });
    find("intakeStart", /(?:start|starts|starting|intake|entry)[^.\n]{0,40}?\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i, (m) => isoFrom(m[1], m[2], m[3]));
    if (!fields.some((f) => f.key === "intakeStart")) find("intakeStart", /(?:start|starts|starting|intake|entry)[^.\n]{0,40}?\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i, (m) => isoFrom("1", m[1], m[2]), "low");
    const start = fields.find((f) => f.key === "intakeStart");
    if (start) fields.push({ key: "intakeLabel", value: start.value.slice(0, 7), quote: start.quote, confidence: start.confidence });
    find("intakeDeadline", /deadline[^.\n]{0,60}?\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i, (m) => isoFrom(m[1], m[2], m[3]));
    if (/\b2:1\b|upper second/i.test(text) && !fields.some((f) => f.key === "minCGPA4")) notes.push("The page asks for a UK 2:1 but gives no Pakistan CGPA equivalent: enter the minimum CGPA yourself.");

    const country = /\.ac\.uk|united kingdom|\bUK\b|£/i.test(req.pages.map((p) => p.url).join(" ") + text) ? "UK" : /\.de\b|germany|deutschland/i.test(text) ? "DE" : /\.it\b|italy|italia/i.test(text) ? "IT" : /\.fr\b|france/i.test(text) ? "FR" : null;
    return toProgrammeExtraction({ isProgrammePage: fields.length >= 2, containsInstructionLikeText: false, country, fields, notes }, req, "mock", "mock-programme-reader-1");
  }
}

