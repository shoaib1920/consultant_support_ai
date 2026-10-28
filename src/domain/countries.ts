// Country definitions: structural knowledge about each destination (which checks exist,
// which documents are needed, attestation chain shape). All NUMBERS and requirement
// switches live in the admin-editable Rules table and are referenced here by ruleKey.
// To add a country: add an entry here + seed its rules (see README "Adding a country").

import type { AttestationAuthority, CountryCode, Currency, DocType, IrreversibleAction, Stage, StudyLevel } from "./types";

export interface CountryCheckDef {
  key: string;
  label: string;
  help: string;
  requiredBefore: IrreversibleAction | "none";
  blocking: boolean; // true => missing at the relevant stage is a hard fail (RED)
  ruleKey?: string; // if the rule value is false, the check is not required
}

export interface DocRequirement {
  docType: DocType;
  label: string;
  neededBefore: IrreversibleAction;
  levels?: StudyLevel[];
  optional?: boolean;
  unlessMOI?: boolean;
}

export interface AttestationTemplate {
  appliesTo: DocType[];
  label: string;
  steps: AttestationAuthority[];
  neededBefore: IrreversibleAction;
}

export interface CountryDef {
  code: CountryCode;
  name: string;
  currency: Currency;
  checks: CountryCheckDef[];
  docs: DocRequirement[];
  attestation: AttestationTemplate[];
  deadlineRuleKeys: { key: string; label: string }[];
}

const BASE_DOCS: DocRequirement[] = [
  { docType: "passport", label: "Passport (bio page + all used pages)", neededBefore: "pay_fee" },
  { docType: "cnic", label: "CNIC (front & back)", neededBefore: "pay_fee" },
  { docType: "photo", label: "Passport-size photographs", neededBefore: "file_visa" },
  { docType: "matric", label: "Matric / O-Level certificate", neededBefore: "pay_fee" },
  { docType: "intermediate", label: "Intermediate / A-Level certificate", neededBefore: "pay_fee" },
  { docType: "degree", label: "Bachelor degree", neededBefore: "pay_fee", levels: ["master", "phd"] },
  { docType: "transcript", label: "Bachelor transcript", neededBefore: "pay_fee", levels: ["master", "phd"] },
  { docType: "english_test", label: "English test report (IELTS/PTE/Duolingo) or MOI", neededBefore: "pay_fee" },
  { docType: "sop", label: "Statement of purpose / motivation letter", neededBefore: "submit_application" },
  { docType: "cv", label: "CV", neededBefore: "submit_application" },
  { docType: "bank_statement", label: "Bank statement(s)", neededBefore: "file_visa" },
  { docType: "sponsor_letter", label: "Sponsor affidavit / letter", neededBefore: "file_visa" },
  { docType: "sponsor_income", label: "Sponsor income / source-of-funds evidence", neededBefore: "file_visa" },
  { docType: "police_certificate", label: "Police character certificate", neededBefore: "file_visa", optional: true },
];

export const COUNTRIES: Record<CountryCode, CountryDef> = {
  UK: {
    code: "UK",
    name: "United Kingdom",
    currency: "GBP",
    checks: [
      { key: "cas_issued", label: "CAS issued", help: "Confirmation of Acceptance for Studies from the licensed sponsor.", requiredBefore: "file_visa", blocking: true },
      { key: "tb_certificate", label: "TB test certificate (approved clinic)", help: "Pakistan residents need a TB certificate from an approved clinic before applying.", requiredBefore: "file_visa", blocking: true, ruleKey: "tb.required_pakistan" },
      { key: "pre_cas_interview", label: "University pre-CAS credibility interview", help: "Many universities interview Pakistani applicants before issuing CAS.", requiredBefore: "file_visa", blocking: false, ruleKey: "credibility.pre_cas_interview" },
    ],
    docs: [
      ...BASE_DOCS,
      { docType: "offer_letter", label: "Offer letter", neededBefore: "file_visa" },
      { docType: "cas", label: "CAS statement", neededBefore: "file_visa" },
      { docType: "medical_tb", label: "TB test certificate", neededBefore: "file_visa" },
    ],
    attestation: [],
    deadlineRuleKeys: [],
  },
  DE: {
    code: "DE",
    name: "Germany",
    currency: "EUR",
    checks: [
      { key: "aps_certificate", label: "APS certificate", help: "Academic Evaluation Centre (APS) certificate — mandatory for Pakistani applicants; uni-assist will not process an application without it, so no fee should be paid first.", requiredBefore: "pay_fee", blocking: true, ruleKey: "aps.mandatory" },
      { key: "admission_route", label: "uni-assist / direct application prepared", help: "Confirm whether the programme uses uni-assist or direct application.", requiredBefore: "submit_application", blocking: false },
      { key: "blocked_account", label: "Blocked account (Sperrkonto) opened & funded", help: "Or another accepted proof of financial resources.", requiredBefore: "file_visa", blocking: true, ruleKey: "funds.blocked_account_required" },
      { key: "health_insurance", label: "Health insurance", help: "Travel/incoming student insurance valid from entry.", requiredBefore: "file_visa", blocking: true },
      { key: "embassy_appointment", label: "Embassy appointment / consular portal", help: "Book early; waiting times are long.", requiredBefore: "file_visa", blocking: false },
    ],
    docs: [
      ...BASE_DOCS,
      { docType: "aps_certificate", label: "APS certificate", neededBefore: "pay_fee" },
      { docType: "offer_letter", label: "Admission letter (Zulassung)", neededBefore: "file_visa" },
      { docType: "blocked_account", label: "Blocked account confirmation", neededBefore: "file_visa" },
      { docType: "health_insurance", label: "Health insurance", neededBefore: "file_visa" },
    ],
    attestation: [
      { appliesTo: ["matric", "intermediate"], label: "School certificates", steps: ["BOARD", "IBCC", "MOFA"], neededBefore: "submit_application" },
      { appliesTo: ["degree", "transcript"], label: "Degree & transcript", steps: ["HEC", "MOFA", "APS"], neededBefore: "submit_application" },
    ],
    deadlineRuleKeys: [],
  },
  IT: {
    code: "IT",
    name: "Italy",
    currency: "EUR",
    checks: [
      { key: "universitaly_validated", label: "Universitaly pre-enrolment validated (green)", help: "The university must validate the pre-enrolment on Universitaly.", requiredBefore: "file_visa", blocking: true, ruleKey: "universitaly.mandatory" },
      { key: "dov_or_cimea", label: "Declaration of Value (DoV) or CIMEA statement", help: "Whichever the university requires.", requiredBefore: "file_visa", blocking: true, ruleKey: "dov_cimea.required" },
      { key: "translation_legalisation", label: "Italian translation & legalisation of qualifications", help: "Originals translated into Italian and legalised as required.", requiredBefore: "file_visa", blocking: true },
      { key: "health_insurance", label: "Health insurance", help: "Valid for the duration of stay.", requiredBefore: "file_visa", blocking: true },
      { key: "accommodation_proof", label: "Accommodation proof", help: "Rental contract, hostel or declaration of hospitality.", requiredBefore: "file_visa", blocking: true },
      { key: "return_ticket", label: "Return ticket / booking or repatriation funds", help: "Required evidence of means to return.", requiredBefore: "file_visa", blocking: false },
      { key: "visa_appointment", label: "Appointment booked (Prenot@mi / VFS)", help: "Book well before the visa deadline.", requiredBefore: "file_visa", blocking: false },
    ],
    docs: [
      ...BASE_DOCS,
      { docType: "offer_letter", label: "Admission / Universitaly summary", neededBefore: "file_visa" },
      { docType: "dov_cimea", label: "DoV or CIMEA statement", neededBefore: "file_visa" },
      { docType: "health_insurance", label: "Health insurance", neededBefore: "file_visa" },
      { docType: "accommodation", label: "Accommodation proof", neededBefore: "file_visa" },
    ],
    attestation: [
      { appliesTo: ["intermediate"], label: "School certificates", steps: ["BOARD", "IBCC", "MOFA", "TRANSLATION"], neededBefore: "file_visa" },
      { appliesTo: ["degree", "transcript"], label: "Degree & transcript", steps: ["HEC", "MOFA", "TRANSLATION", "DOV"], neededBefore: "file_visa" },
    ],
    deadlineRuleKeys: [{ key: "visa.application_deadline", label: "Italy visa application deadline" }],
  },
  FR: {
    code: "FR",
    name: "France",
    currency: "EUR",
    checks: [
      { key: "eef_file", label: "Campus France / Études en France (EEF) file completed", help: "Online EEF file must be completed and submitted.", requiredBefore: "file_visa", blocking: true, ruleKey: "campusfrance.mandatory" },
      { key: "campus_france_interview", label: "Campus France interview (Karachi / Lahore / Islamabad)", help: "Must be completed before the visa appointment.", requiredBefore: "file_visa", blocking: true, ruleKey: "campusfrance.mandatory" },
      { key: "accommodation_proof", label: "Accommodation proof", help: "Residence attestation or booking.", requiredBefore: "file_visa", blocking: true },
      { key: "health_insurance", label: "Health insurance", help: "Coverage until French student social security applies.", requiredBefore: "file_visa", blocking: true },
      { key: "ofii_validation", label: "VLS-TS validation with OFII (after arrival)", help: "Validate online within 3 months of arrival.", requiredBefore: "none", blocking: false },
    ],
    docs: [
      ...BASE_DOCS,
      { docType: "offer_letter", label: "Admission letter", neededBefore: "file_visa" },
      { docType: "accommodation", label: "Accommodation proof", neededBefore: "file_visa" },
      { docType: "health_insurance", label: "Health insurance", neededBefore: "file_visa" },
    ],
    attestation: [{ appliesTo: ["degree", "transcript"], label: "Degree & transcript", steps: ["HEC", "MOFA"], neededBefore: "file_visa" }],
    deadlineRuleKeys: [],
  },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export const DOC_LABELS: Record<DocType, string> = {
  passport: "Passport",
  cnic: "CNIC",
  photo: "Photograph",
  matric: "Matric / O-Level",
  intermediate: "Intermediate / A-Level",
  degree: "Degree",
  transcript: "Transcript",
  english_test: "English test",
  bank_statement: "Bank statement",
  sponsor_letter: "Sponsor letter",
  sponsor_income: "Sponsor income evidence",
  police_certificate: "Police certificate",
  sop: "SOP / motivation letter",
  cv: "CV",
  medical_tb: "TB certificate",
  aps_certificate: "APS certificate",
  cas: "CAS",
  offer_letter: "Offer / admission letter",
  dov_cimea: "DoV / CIMEA",
  health_insurance: "Health insurance",
  accommodation: "Accommodation proof",
  blocked_account: "Blocked account confirmation",
  other: "Other",
};

const ACTION_ORDER: IrreversibleAction[] = ["pay_fee", "submit_application", "file_visa"];

/** Which irreversible action is next for a case at this stage (null once the visa is filed). */
export function nextIrreversibleAction(stage: Stage): IrreversibleAction | null {
  const idx = ["Lead", "Profile Complete", "Docs Verified", "Eligibility Passed", "Manager Approved"].indexOf(stage);
  if (idx >= 0) return "pay_fee";
  if (stage === "Payment Authorized") return "submit_application";
  if (stage === "Submitted" || stage === "Offer/Admission") return "file_visa";
  return null;
}

/** True when an item needed before `neededBefore` is due given the case's next irreversible action. */
export function isDueNow(neededBefore: IrreversibleAction | "none", stage: Stage, horizon: IrreversibleAction | null = nextIrreversibleAction(stage)): boolean {
  if (neededBefore === "none" || horizon === null) return false;
  return ACTION_ORDER.indexOf(neededBefore) <= ACTION_ORDER.indexOf(horizon);
}

export function requiredDocsFor(country: CountryCode, level: StudyLevel): DocRequirement[] {
  return COUNTRIES[country].docs.filter((d) => !d.levels || d.levels.includes(level));
}

export const ACTION_LABELS: Record<IrreversibleAction, string> = {
  pay_fee: "Pay non-refundable fee",
  submit_application: "Submit university application",
  file_visa: "File visa application",
};
