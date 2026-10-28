// Loads everything needed to evaluate a case (eligibility, gates, report) in one place.

import { profileCompleteness } from "@/domain/completeness";
import type { GateContext } from "@/domain/gates";
import type {
  Approval,
  Attestation,
  Case,
  DocumentRecord,
  EligibilityResult,
  ExtractedFields,
  FinancialAnalysis,
  Payment,
  Programme,
  RiskAcknowledgment,
  Rule,
  Student,
} from "@/domain/types";
import type { Repo } from "../db";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export interface CaseBundle {
  kase: Case;
  student: Student;
  documents: DocumentRecord[];
  extracted: ExtractedFields[];
  attestations: Attestation[];
  financial?: FinancialAnalysis;
  eligibility?: EligibilityResult;
  approvals: Approval[];
  riskAcks: RiskAcknowledgment[];
  payments: Payment[];
  programme?: Programme;
  rules: Rule[];
}

function latestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

export async function loadCaseBundle(repo: Repo, organizationId: string, caseId: string): Promise<CaseBundle> {
  const kase = await repo.get<Case>("cases", caseId);
  if (!kase || kase.organizationId !== organizationId) throw new NotFoundError("Case");
  const org: [string, "==", string] = ["organizationId", "==", organizationId];
  const [student, documents, extracted, attestations, financials, eligibilities, approvals, riskAcks, payments, rules, programme] = await Promise.all([
    repo.get<Student>("students", kase.studentId),
    repo.list<DocumentRecord>("documents", [org, ["studentId", "==", kase.studentId]]),
    repo.list<ExtractedFields>("extractedFields", [org, ["studentId", "==", kase.studentId]]),
    repo.list<Attestation>("attestations", [org, ["caseId", "==", caseId]]),
    // equality-only queries + in-code sort: no composite index needed (works before indexes are deployed)
    repo.list<FinancialAnalysis>("financialAnalyses", [org, ["caseId", "==", caseId]]).then(latestFirst),
    repo.list<EligibilityResult>("eligibilityResults", [org, ["caseId", "==", caseId]]).then(latestFirst),
    repo.list<Approval>("approvals", [org, ["caseId", "==", caseId]]),
    repo.list<RiskAcknowledgment>("riskAcknowledgments", [org, ["caseId", "==", caseId]]),
    repo.list<Payment>("payments", [org, ["caseId", "==", caseId]]),
    repo.list<Rule>("rules", [org]),
    kase.programmeId ? repo.get<Programme>("programmes", kase.programmeId).then((p) => (p?.organizationId === organizationId ? p : null)) : Promise.resolve(null),
  ]);
  if (!student) throw new NotFoundError("Student");
  // Documents for this case = case-specific docs + student-level docs (no caseId)
  const docs = documents.filter((d) => !d.caseId || d.caseId === caseId);
  return {
    kase,
    student,
    documents: docs,
    extracted,
    attestations,
    financial: financials[0],
    eligibility: eligibilities[0],
    approvals,
    riskAcks,
    payments,
    programme: programme ?? undefined,
    rules,
  };
}

export function gateContext(b: CaseBundle): GateContext {
  return {
    kase: b.kase,
    student: b.student,
    documents: b.documents,
    eligibility: b.eligibility,
    approvals: b.approvals,
    riskAcks: b.riskAcks,
    completenessPercent: profileCompleteness(b.student).percent,
  };
}
