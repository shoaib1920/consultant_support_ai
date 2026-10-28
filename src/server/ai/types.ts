import { z } from "zod";
import type { AiNarrative, BankTransaction, Confidence, DocType, EligibilityResult, Student } from "@/domain/types";

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
  source: "claude" | "mock";
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

export interface AIProvider {
  readonly name: "claude" | "mock";
  extract(req: ExtractionRequest): Promise<ExtractionOutput>;
  narrate(req: NarrativeRequest): Promise<AiNarrative>;
}
