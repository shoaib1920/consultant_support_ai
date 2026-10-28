// Core domain types for VisaGuard. Framework-free: shared by the Next.js server,
// Cloud Functions and unit tests. Every persisted record carries organizationId.

export type Role = "owner" | "manager" | "officer" | "counsellor" | "student";
export const STAFF_ROLES: Role[] = ["owner", "manager", "officer", "counsellor"];
export const APPROVER_ROLES: Role[] = ["owner", "manager"];

export type CountryCode = "UK" | "DE" | "IT" | "FR";
export type StudyLevel = "foundation" | "bachelor" | "master" | "phd";
export type Light = "GREEN" | "AMBER" | "RED";
export type Severity = "info" | "warning" | "critical";
export type RuleStatus = "Verified" | "Unverified" | "Conflicting";
export type Confidence = "high" | "medium" | "low";
export type Currency = "PKR" | "GBP" | "EUR" | "USD";

export interface Base {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
  defaultCurrency: Currency;
}

export interface User extends Base {
  email: string;
  name: string;
  role: Role;
  active: boolean;
  studentId?: string; // for role=student
  passwordHint?: string; // demo only
}

// ---------------- Student profile ----------------

export type EducationLevel = "matric" | "o_level" | "intermediate" | "a_level" | "bachelor" | "master";
export type GradeType = "percentage" | "cgpa" | "grade";

export interface EducationRecord {
  id: string;
  level: EducationLevel;
  institution: string;
  board?: string;
  program?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  gradeType: GradeType;
  obtained?: number; // marks obtained or CGPA
  total?: number; // total marks or CGPA scale max (e.g. 4)
  backlogs?: number;
  completed: boolean;
}

export interface StudyGap {
  id: string;
  from: string;
  to: string;
  reason: string;
  evidence?: string;
}

export type EnglishTestType = "IELTS" | "PTE" | "Duolingo" | "TOEFL" | "MOI";
export interface EnglishTest {
  id: string;
  type: EnglishTestType;
  overall?: number;
  listening?: number;
  reading?: number;
  writing?: number;
  speaking?: number;
  testDate?: string;
  expiryDate?: string;
}

export interface WorkExperience {
  id: string;
  employer: string;
  title: string;
  from: string;
  to?: string;
  description?: string;
}

export interface Sponsor {
  id: string;
  name: string;
  relation: string;
  occupation?: string;
  annualIncomePKR?: number;
  phone?: string;
}

export interface VisaRefusal {
  id: string;
  country: string;
  year: number;
  visaType?: string;
  reason?: string;
}

export interface TravelRecord {
  id: string;
  country: string;
  year: number;
  purpose?: string;
}

export interface StudentPersonal {
  fullName: string;
  givenNames?: string;
  surname?: string;
  fatherName?: string;
  dob?: string;
  gender?: "male" | "female" | "other";
  cnic?: string;
  passportNumber?: string;
  passportExpiry?: string;
  nationality: string;
  city?: string;
  phone?: string;
  email?: string;
  address?: string;
  maritalStatus?: "single" | "married" | "other";
}

export interface Student extends Base {
  personal: StudentPersonal;
  education: EducationRecord[];
  gaps: StudyGap[];
  englishTests: EnglishTest[];
  work: WorkExperience[];
  sponsors: Sponsor[];
  budget: { totalPKR?: number; notes?: string };
  intended: { level?: StudyLevel; field?: string; intake?: string; countries: CountryCode[] };
  refusals: VisaRefusal[];
  travel: TravelRecord[];
  tiesToPakistan?: string;
  consent: { given: boolean; at?: string; by?: string; version?: string };
  counsellorId?: string;
  portalUserId?: string;
  intakeToken?: string;
  intakeTokenExpiresAt?: string;
  internalNotes?: string; // staff-only, never shown in portal
  deletionRequestedAt?: string;
}

// ---------------- Cases ----------------

export const STAGES = [
  "Lead",
  "Profile Complete",
  "Docs Verified",
  "Eligibility Passed",
  "Manager Approved",
  "Payment Authorized",
  "Submitted",
  "Offer/Admission",
  "Visa Filed",
  "Decision",
  "Pre-departure",
] as const;
export type Stage = (typeof STAGES)[number];

export type CheckStatus = "complete" | "in_progress" | "not_started" | "not_required";
export interface CountryCheckState {
  status: CheckStatus;
  date?: string;
  reference?: string;
  note?: string;
}

export interface CasDetails {
  name?: string;
  course?: string;
  tuitionFee?: number;
  startDate?: string;
  endDate?: string;
}

export interface Case extends Base {
  studentId: string;
  studentName: string; // denormalised for lists
  country: CountryCode;
  programmeId?: string;
  universityName: string;
  programmeName: string;
  programmeField?: string;
  level: StudyLevel;
  intake: string; // YYYY-MM
  intakeStartDate: string; // ISO date
  applicationDeadline?: string;
  plannedVisaApplicationDate?: string;
  city?: string;
  inLondon?: boolean;
  courseMonths: number;
  tuitionFee: { amount: number; currency: Currency };
  tuitionPaid: number;
  minCGPA4?: number; // snapshot of programme requirement
  minGermanGrade?: number;
  englishRequirement?: { ielts?: number; pte?: number; duolingo?: number; moiAccepted?: boolean };
  stage: Stage;
  stageHistory: { stage: Stage; at: string; by: string }[];
  assignedOfficerId?: string;
  counsellorId?: string;
  countryChecks: Record<string, CountryCheckState>;
  cas?: CasDetails;
  offer?: { type: "conditional" | "unconditional"; receivedAt: string; reference?: string };
  decision?: { outcome: "approved" | "refused" | "withdrawn"; at: string; reason?: string };
  // denormalised from latest eligibility result
  light?: Light;
  score?: number;
  criticalFlags?: number;
  ruleIssues?: number;
  latestEligibilityId?: string;
  dataVersion: number; // bumped on any input change; eligibility must match to be "fresh"
  demoTag?: string;
}

// ---------------- Documents ----------------

export type DocType =
  | "passport"
  | "cnic"
  | "photo"
  | "matric"
  | "intermediate"
  | "degree"
  | "transcript"
  | "english_test"
  | "bank_statement"
  | "sponsor_letter"
  | "sponsor_income"
  | "police_certificate"
  | "sop"
  | "cv"
  | "medical_tb"
  | "aps_certificate"
  | "cas"
  | "offer_letter"
  | "dov_cimea"
  | "health_insurance"
  | "accommodation"
  | "blocked_account"
  | "other";

export type ReviewStatus = "pending" | "verified" | "needs_manual_verification" | "rejected";

export interface DocumentFlag {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  field?: string;
  relatedDocumentIds?: string[];
  needsManualVerification: boolean;
  resolved?: { by: string; at: string; note: string };
}

export interface DocumentRecord extends Base {
  studentId: string;
  caseId?: string;
  docType: DocType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedBy: string;
  uploadedVia: "staff" | "portal" | "seed";
  pageCount?: number;
  extractionStatus: "pending" | "done" | "failed" | "manual";
  extractedFieldsId?: string;
  completeness?: { allPages: boolean; legible: boolean; notExpired: boolean; correctType: boolean; notes: string[] };
  flags: DocumentFlag[];
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface ExtractedFields extends Base {
  documentId: string;
  studentId: string;
  docType: DocType;
  fields: Record<string, string | number | boolean | null>;
  fieldConfidence: Record<string, Confidence>;
  detectedDocType?: DocType;
  pagesDetected?: number;
  legible?: boolean;
  expiryDate?: string | null;
  injectionSuspected?: boolean;
  source: "claude" | "mock" | "manual" | "seed";
  model?: string;
  promptVersion?: string;
  transactions?: BankTransaction[]; // for bank statements
}

// ---------------- Attestation ----------------

export type AttestationAuthority = "BOARD" | "IBCC" | "HEC" | "MOFA" | "EMBASSY" | "APS" | "DOV" | "CIMEA" | "TRANSLATION";
export type AttestationStatus = "not_started" | "submitted" | "in_progress" | "completed" | "rejected" | "not_required";

export interface AttestationStep {
  authority: AttestationAuthority;
  status: AttestationStatus;
  submittedAt?: string;
  completedAt?: string;
  expectedDays: number;
  reference?: string;
}

export interface Attestation extends Base {
  caseId: string;
  studentId: string;
  documentId?: string;
  documentLabel: string;
  country: CountryCode;
  steps: AttestationStep[];
}

// ---------------- Rules ----------------

export type RuleValue = number | string | boolean;
export interface Rule extends Base {
  country: CountryCode | "*";
  level: StudyLevel | "*";
  intake: string; // "*" or e.g. "2026-27"
  key: string;
  label: string;
  value: RuleValue;
  unit: string;
  sourceUrl: string;
  sourceNote?: string;
  lastVerifiedAt?: string;
  verifiedBy?: string;
  status: RuleStatus;
  notes?: string;
  seed?: boolean;
}

export interface RuleChange extends Base {
  ruleId: string;
  ruleKey: string;
  country: string;
  changedBy: string;
  changedByName: string;
  action: "create" | "update" | "verify" | "status";
  before?: Partial<Rule>;
  after?: Partial<Rule>;
  reason?: string;
}

// ---------------- Universities & programmes ----------------

export interface University extends Base {
  name: string;
  country: CountryCode;
  city: string;
  inLondon?: boolean;
  complianceNotes?: string;
  pakistanStrictness?: "normal" | "elevated" | "high";
  sampleData: boolean;
}

export interface Intake {
  label: string; // YYYY-MM
  startDate: string;
  applicationDeadline: string;
}

export interface Programme extends Base {
  universityId: string;
  universityName: string;
  country: CountryCode;
  city: string;
  inLondon?: boolean;
  name: string;
  level: StudyLevel;
  field: string;
  keywords: string[];
  minCGPA4?: number;
  minGermanGrade?: number;
  english: { ielts?: number; pte?: number; duolingo?: number; moiAccepted?: boolean; germanLevel?: string };
  tuitionPerYear: number;
  currency: Currency;
  durationMonths: number;
  intakes: Intake[];
  complianceNotes?: string;
  sampleData: boolean;
  active: boolean;
}

// ---------------- Eligibility ----------------

export type ReasonCategory =
  | "Academic"
  | "Language"
  | "Financial"
  | "Documents"
  | "Timeline"
  | "Credibility"
  | "Country"
  | "Rules";

export interface ReasonRef {
  type: "rule" | "document" | "missing" | "field" | "programme" | "analysis";
  id?: string;
  label: string;
}

export interface Reason {
  id: string;
  category: ReasonCategory;
  severity: Severity;
  hardFail: boolean; // deterministic failure -> RED
  title: string;
  detail: string;
  fix?: string;
  askStudent?: string;
  refs: ReasonRef[];
  confidence: Confidence;
  insufficientData?: boolean;
}

export interface EligibilityResult extends Base {
  caseId: string;
  studentId: string;
  dataVersion: number;
  /** Hash of light + reasons + rule issues. Overrides/acks bind to this, so any material change voids them. */
  fingerprint: string;
  score: number;
  light: Light;
  lightReason: string;
  criticalFlags: number;
  reasons: Reason[];
  categoryScores: Partial<Record<ReasonCategory, { score: number; light: Light }>>;
  ruleIdsUsed: string[];
  ruleIssues: { ruleId: string; key: string; problem: "Unverified" | "Conflicting" | "Stale" | "Missing" }[];
  engineVersion: string;
  ai?: AiNarrative;
}

export interface AiNarrative {
  summary: string;
  points: { text: string; cites: string[]; confidence: Confidence }[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  source: "claude" | "mock";
}

// ---------------- Financial ----------------

export interface BankTransaction {
  date: string;
  description: string;
  amount: number; // + credit / - debit
  balance: number; // closing balance after this transaction
}

export interface FundsRequirementLine {
  label: string;
  amount: number;
  currency: Currency;
  ruleId?: string;
  ruleKey?: string;
}

export interface FundsRequirement {
  country: CountryCode;
  currency: Currency;
  total: number;
  lines: FundsRequirementLine[];
  ruleIdsUsed: string[];
  notes: string[];
}

export interface LargeDeposit {
  date: string;
  amount: number;
  description: string;
  ratioToPriorAverage: number;
  explained: boolean;
  explanation?: string;
}

export interface FinancialAnalysis extends Base {
  caseId: string;
  studentId: string;
  documentId?: string;
  inputMode: "ai" | "manual" | "mock" | "seed";
  statementCurrency: Currency;
  accountHolder?: string;
  bankName?: string;
  statementStart: string;
  statementEnd: string;
  applicationDate: string;
  requirement: FundsRequirement;
  fx?: { from: Currency; to: Currency; rate: number; date: string; ruleId?: string };
  requiredInStatementCurrency: number;
  window?: { start: string; end: string; days: number };
  lowestBalance?: { amount: number; date: string };
  firstFailure?: { dayIndex: number; date: string; balance: number; shortfall: number };
  lastFailureDate?: string;
  earliestCompliantApplicationDate?: string;
  statementAgeDays: number;
  largeDeposits: LargeDeposit[];
  sourceOfFundsMissing: boolean;
  passes: boolean;
  problems: { severity: Severity; code: string; message: string }[];
  fixActions: string[];
  dailyBalances: { date: string; balance: number }[];
  ruleIdsUsed: string[];
  isBlockedAccount?: boolean;
}

// ---------------- Matching ----------------

export type Band = "Low" | "Moderate" | "Good";
export interface MatchOption {
  programmeId: string;
  programmeName: string;
  universityName: string;
  country: CountryCode;
  fitScore: number;
  estimatedTotalCost: { amount: number; currency: Currency; amountPKR: number };
  acceptanceBand: Band;
  visaRiskBand: "Low" | "Medium" | "High";
  intake?: Intake;
  intakeStatus: "open" | "closing_soon" | "closed" | "none";
  missing: string[];
  why: string[];
}

export interface MatchResult extends Base {
  studentId: string;
  options: MatchOption[];
  strongMatch: boolean;
  honestSummary: string;
  alternatives: string[];
}

// ---------------- Gates / approvals / payments ----------------

export type IrreversibleAction = "pay_fee" | "submit_application" | "file_visa";

export interface GateEvent extends Base {
  caseId: string;
  type: "transition" | "blocked" | "override" | "preflight_started" | "preflight_confirmed" | "preflight_executed" | "preflight_cancelled";
  fromStage?: Stage;
  toStage?: Stage;
  action?: IrreversibleAction;
  blockers?: string[];
  amountAtRisk?: { amount: number; currency: Currency; amountPKR: number };
  by: string;
  byName: string;
  note?: string;
}

export interface PreflightSnapshot {
  light: Light;
  score: number;
  eligibilityId: string;
  openWarnings: string[];
  criticalFlags: number;
  ruleStatus: { key: string; problem: string }[];
}

export interface Approval extends Base {
  caseId: string;
  kind: "preflight" | "override" | "manager_approval";
  action?: IrreversibleAction;
  payment?: { type: PaymentType; amount: number; currency: Currency; amountPKR: number; refundable: boolean; payee?: string };
  snapshot?: PreflightSnapshot;
  eligibilityId?: string;
  eligibilityFingerprint?: string;
  reason?: string;
  requestedBy: string;
  requestedByName: string;
  officerConfirmedBy?: string;
  officerConfirmedAt?: string;
  managerConfirmedBy?: string;
  managerConfirmedAt?: string;
  status: "pending_manager" | "approved" | "executed" | "cancelled" | "rejected" | "superseded";
  executedAt?: string;
}

export interface RiskAcknowledgment extends Base {
  caseId: string;
  studentId: string;
  eligibilityId: string;
  eligibilityFingerprint: string;
  overrideApprovalId?: string;
  risks: string[]; // plain-language
  status: "pending" | "signed" | "void";
  signedName?: string;
  signatureDataUrl?: string;
  signedAt?: string;
  signedByUserId?: string;
  userAgent?: string;
}

export type PaymentType =
  | "consultancy_fee"
  | "application_fee"
  | "tuition_deposit"
  | "visa_fee"
  | "ihs"
  | "insurance"
  | "blocked_account"
  | "attestation_fee"
  | "courier"
  | "other";

export interface Payment extends Base {
  caseId: string;
  studentId: string;
  type: PaymentType;
  description?: string;
  amount: number;
  currency: Currency;
  amountPKR: number;
  refundable: boolean;
  status: "authorized" | "paid" | "refunded" | "void";
  authorizedBy: string[];
  authorizedAt: string;
  approvalId?: string;
  receiptPath?: string;
  recordedBy: string;
}

// ---------------- Tasks / notifications / audit ----------------

export interface Task extends Base {
  caseId?: string;
  studentId?: string;
  templateKey: string;
  title: string;
  detail?: string;
  stage?: Stage;
  dueDate?: string;
  assigneeId?: string;
  status: "open" | "done";
  completedAt?: string;
  completedBy?: string;
  auto: boolean;
}

export interface Notification extends Base {
  userId: string;
  caseId?: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  kind: "info" | "warning" | "critical";
}

export interface AuditEntry {
  id: string;
  organizationId: string;
  seq: number;
  at: string;
  userId: string;
  userName: string;
  role: Role | "system";
  action: string;
  entity: string;
  entityId: string;
  caseId?: string;
  before?: unknown;
  after?: unknown;
  ai?: { model: string; promptVersion: string; source: "claude" | "mock" };
  prevHash: string;
  hash: string;
}

export interface Deadline {
  key: string;
  label: string;
  date: string;
  daysLeft: number;
  severity: Severity;
  caseId?: string;
}
