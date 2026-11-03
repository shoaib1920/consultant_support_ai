import { z } from "zod";
import type { AiNarrative, AiSource, BankTransaction, Confidence, CountryCode, DocType, EligibilityResult, ProgrammeSourceField, Student } from "@/domain/types";

export const ExtractionSchema = z.object({
  detectedDocType: z.string(),
  pagesDetected: z.number().int().min(0).max(500),
  totalPagesStated: z.number().int().nullable(),
  legible: z.boolean(),
  expiryDate: z.string().nullable(),
  containsInstructionLikeText: z.boolean(),
  fields: z.array(z.object({ key: z.string().max(64), value: z.string().max(2000), confidence: z.enum(["high", "medium", "low"]) })).max(200),
  transactions: z.array(z.object({ date: z.string(), description: z.string().max(300), amount: z.number(), balance: z.number() })).max(2000),
});

export interface ExtractionOutput {
  detectedDocType: DocType;
  pagesDetected: number;
  legible: boolean;
  expiryDate: string | null;
  injectionSuspected: boolean;
  fields: Record<string, string | number | boolean | null>;
  fieldConfidence: Record<string, Confidence>;
  transactions: BankTransaction[];
  source: AiSource;
  model: string;
  promptVersion: string;
}

export interface ExtractionRequest {
  docType: DocType;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  student: Student;
}

export interface NarrativeRequest {
  result: Pick<EligibilityResult, "light" | "score" | "lightReason" | "reasons" | "ruleIssues">;
  caseSummary: string;
}

export const ProgrammeExtractionSchema = z.object({
  isProgrammePage: z.boolean(),
  containsInstructionLikeText: z.boolean(),
  country: z.string().nullable(),
  fields: z.array(z.object({ key: z.string().max(64), value: z.string().max(500), quote: z.string().max(600), confidence: z.enum(["high", "medium", "low"]) })).max(60),
  notes: z.array(z.string().max(400)).max(12),
});

export interface ProgrammePageRequest {
  pages: { url: string; kind: "html" | "pdf" | "text"; text: string; bytes?: Buffer; title?: string }[];
  today: string;
  background?: boolean; // nightly re-check: may wait for quota, and leaves headroom for staff
}

/** Raw values as read from the page (strings), keyed by ProgrammeSourceField; normalised by the service. */
export interface ProgrammeExtraction {
  isProgrammePage: boolean;
  injectionSuspected: boolean;
  country: CountryCode | null;
  fields: Partial<Record<ProgrammeSourceField, { value: string; quote: string; confidence: Confidence }>>;
  notes: string[];
  source: AiSource;
  model: string;
  promptVersion: string;
}

export interface AIProvider {
  readonly name: AiSource;
  extract(req: ExtractionRequest): Promise<ExtractionOutput>;
  narrate(req: NarrativeRequest): Promise<AiNarrative>;
  extractProgramme(req: ProgrammePageRequest): Promise<ProgrammeExtraction>;
}
