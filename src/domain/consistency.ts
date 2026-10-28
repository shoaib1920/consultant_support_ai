// Cross-document consistency engine and single-document completeness checks.
// It never accuses: every discrepancy is phrased as "NEEDS MANUAL VERIFICATION" and a human decides.

import { addDays, daysBetween, isBefore, todayISO } from "./dates";
import type { DocType, DocumentFlag, Severity, Student } from "./types";

export interface DocFields {
  documentId: string;
  docType: DocType;
  label: string;
  fields: Record<string, string | number | boolean | null>;
  detectedDocType?: DocType;
  pagesDetected?: number;
  legible?: boolean;
  expiryDate?: string | null;
  injectionSuspected?: boolean;
}

export interface ConsistencyFlag {
  severity: Severity;
  code: string;
  field: string;
  message: string;
  documentIds: string[];
}

// ---------- normalisation ----------

const NAME_VARIANTS: Record<string, string> = {
  mohammad: "muhammad",
  mohammed: "muhammad",
  muhammed: "muhammad",
  mohamed: "muhammad",
  mohd: "muhammad",
  md: "muhammad",
  muhamad: "muhammad",
  ahmed: "ahmad",
  hussain: "husain",
  hussein: "husain",
  syed: "sayed",
  sayyed: "sayed",
};

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(mr|mrs|ms|miss|dr)\.?\s/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NAME_VARIANTS[t] ?? t);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

export type NameMatch = "exact" | "variant" | "mismatch";

/** exact: same tokens (any order, after transliteration folding); variant: small spelling difference; else mismatch. */
export function compareNames(a: string, b: string): NameMatch {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return "mismatch";
  const sa = [...ta].sort().join(" ");
  const sb = [...tb].sort().join(" ");
  if (sa === sb) return "exact";
  const dist = levenshtein(sa, sb);
  const ratio = 1 - dist / Math.max(sa.length, sb.length);
  const setA = new Set(ta);
  const overlap = tb.filter((t) => setA.has(t)).length / Math.max(ta.length, tb.length);
  if (ratio >= 0.85 || overlap >= 0.66) return "variant";
  return "mismatch";
}

export function normaliseDate(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/); // DD/MM/YYYY (Pakistani convention)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = Date.parse(s);
  return Number.isNaN(d) ? undefined : new Date(d).toISOString().slice(0, 10);
}

export function normaliseId(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function textSimilar(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\b(the|of|and|university|college|institute|school|board|intermediate|secondary|education)\b/g, " ").replace(/[^a-z0-9]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.75;
}

// ---------- cross-document ----------

const NAME_FIELDS = ["fullName", "holderName", "studentName", "candidateName", "name"];

function pickName(f: DocFields["fields"]): string | undefined {
  for (const k of NAME_FIELDS) if (typeof f[k] === "string" && f[k]) return f[k] as string;
  return undefined;
}

export interface CaseRefs {
  universityName?: string;
  programmeName?: string;
  tuitionFee?: number;
  intakeStartDate?: string;
}

export function crossDocumentConsistency(student: Student, docs: DocFields[], refs: CaseRefs = {}): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = [];
  const profileName = student.personal.fullName;
  const passport = docs.find((d) => d.docType === "passport");
  const anchorName = (passport && pickName(passport.fields)) || profileName;
  const anchorLabel = passport && pickName(passport.fields) ? "passport" : "profile";

  // Names on every identity/academic/financial doc vs anchor (passport if present).
  for (const d of docs) {
    if (d.docType === "bank_statement" || d.docType === "sponsor_letter" || d.docType === "sponsor_income") continue;
    const n = pickName(d.fields);
    if (!n || d === passport) continue;
    const m = compareNames(anchorName, n);
    if (m === "variant") {
      flags.push({
        severity: "warning",
        code: "NAME_VARIANT",
        field: "name",
        message: `Name spelling differs: "${n}" on ${d.label} vs "${anchorName}" on ${anchorLabel}. NEEDS MANUAL VERIFICATION — confirm it is the same person; spelling differences often cause visa queries (an affidavit/name-correction may be needed).`,
        documentIds: [d.documentId, ...(passport ? [passport.documentId] : [])],
      });
    } else if (m === "mismatch") {
      flags.push({
        severity: "critical",
        code: "NAME_MISMATCH",
        field: "name",
        message: `Name on ${d.label} ("${n}") does not match ${anchorLabel} ("${anchorName}"). NEEDS MANUAL VERIFICATION — check the correct file was uploaded for this student.`,
        documentIds: [d.documentId, ...(passport ? [passport.documentId] : [])],
      });
    }
  }
  if (passport && pickName(passport.fields) && compareNames(profileName, pickName(passport.fields)!) !== "exact") {
    flags.push({
      severity: compareNames(profileName, pickName(passport.fields)!) === "mismatch" ? "critical" : "info",
      code: "PROFILE_NAME_DIFFERS",
      field: "name",
      message: `Profile name "${profileName}" differs from passport "${pickName(passport.fields)}". Use the passport spelling on all applications.`,
      documentIds: [passport.documentId],
    });
  }

  // Date of birth
  const dobs = docs
    .map((d) => ({ d, v: normaliseDate(d.fields.dob ?? d.fields.dateOfBirth) }))
    .filter((x) => x.v);
  const anchorDob = normaliseDate(passport?.fields.dob ?? passport?.fields.dateOfBirth) ?? student.personal.dob;
  for (const { d, v } of dobs) {
    if (anchorDob && v !== anchorDob) {
      flags.push({
        severity: "critical",
        code: "DOB_MISMATCH",
        field: "dob",
        message: `Date of birth on ${d.label} (${v}) differs from ${passport ? "passport" : "profile"} (${anchorDob}). NEEDS MANUAL VERIFICATION.`,
        documentIds: [d.documentId],
      });
    }
  }

  // Passport number across docs (passport, CAS, insurance, Universitaly, etc.)
  const anchorPassportNo = normaliseId(passport?.fields.passportNumber ?? student.personal.passportNumber);
  for (const d of docs) {
    const v = d.fields.passportNumber;
    if (!v || d === passport || !anchorPassportNo) continue;
    if (normaliseId(v) !== anchorPassportNo) {
      flags.push({
        severity: "critical",
        code: "PASSPORT_NO_MISMATCH",
        field: "passportNumber",
        message: `Passport number on ${d.label} (${v}) does not match passport (${anchorPassportNo}). NEEDS MANUAL VERIFICATION — an incorrect number on CAS/insurance/forms must be corrected before filing.`,
        documentIds: [d.documentId, ...(passport ? [passport.documentId] : [])],
      });
    }
  }
  if (passport?.fields.passportNumber && student.personal.passportNumber && normaliseId(passport.fields.passportNumber) !== normaliseId(student.personal.passportNumber)) {
    flags.push({
      severity: "warning",
      code: "PROFILE_PASSPORT_DIFFERS",
      field: "passportNumber",
      message: `Profile passport number differs from the passport document. Update the profile after checking.`,
      documentIds: [passport.documentId],
    });
  }

  // CNIC
  const cnicDocs = docs.filter((d) => d.fields.cnic);
  const anchorCnic = normaliseId(student.personal.cnic);
  for (const d of cnicDocs) {
    if (anchorCnic && normaliseId(d.fields.cnic) !== anchorCnic) {
      flags.push({ severity: "warning", code: "CNIC_MISMATCH", field: "cnic", message: `CNIC on ${d.label} differs from profile. NEEDS MANUAL VERIFICATION.`, documentIds: [d.documentId] });
    }
  }

  // Father's name
  const anchorFather = student.personal.fatherName;
  for (const d of docs) {
    const v = d.fields.fatherName;
    if (typeof v === "string" && v && anchorFather && compareNames(anchorFather, v) === "mismatch") {
      flags.push({ severity: "warning", code: "FATHER_NAME_MISMATCH", field: "fatherName", message: `Father's name on ${d.label} ("${v}") differs from profile ("${anchorFather}"). NEEDS MANUAL VERIFICATION.`, documentIds: [d.documentId] });
    }
  }

  // Institution names: academic docs vs profile education history
  for (const d of docs.filter((x) => ["matric", "intermediate", "degree", "transcript"].includes(x.docType))) {
    const inst = d.fields.institution;
    const lv = d.docType === "transcript" || d.docType === "degree" ? ["bachelor", "master"] : d.docType === "matric" ? ["matric", "o_level"] : ["intermediate", "a_level"];
    const rec = student.education.find((e) => lv.includes(e.level));
    if (rec && typeof inst === "string" && inst && !textSimilar(rec.board || rec.institution, inst) && !textSimilar(rec.institution, inst)) {
      flags.push({ severity: "warning", code: "INSTITUTION_MISMATCH", field: "institution", message: `Institution on ${d.label} ("${inst}") differs from profile ("${rec.institution}"). NEEDS MANUAL VERIFICATION.`, documentIds: [d.documentId] });
    }
    // CGPA / marks on transcript vs profile
    const cg = Number(d.fields.cgpa ?? d.fields.obtained);
    if (rec && Number.isFinite(cg) && rec.obtained != null && Math.abs(cg - rec.obtained) > 0.011 && d.fields.cgpa != null) {
      flags.push({ severity: "critical", code: "GRADE_MISMATCH", field: "cgpa", message: `Result on ${d.label} (${cg}) differs from the profile (${rec.obtained}). Eligibility uses the profile value — NEEDS MANUAL VERIFICATION before any payment.`, documentIds: [d.documentId] });
    }
  }

  // Degree vs transcript completion dates
  const degree = docs.find((d) => d.docType === "degree");
  const transcript = docs.find((d) => d.docType === "transcript");
  if (degree && transcript) {
    const a = normaliseDate(degree.fields.completionDate);
    const b = normaliseDate(transcript.fields.completionDate);
    if (a && b && Math.abs(daysBetween(a, b)) > 120) {
      flags.push({ severity: "warning", code: "COMPLETION_DATE_MISMATCH", field: "completionDate", message: `Degree completion (${a}) and transcript completion (${b}) differ by more than 4 months. NEEDS MANUAL VERIFICATION.`, documentIds: [degree.documentId, transcript.documentId] });
    }
  }

  // CAS must match application exactly (UK)
  const cas = docs.find((d) => d.docType === "cas");
  if (cas) {
    if (refs.programmeName && typeof cas.fields.course === "string" && !textSimilar(cas.fields.course, refs.programmeName)) {
      flags.push({ severity: "critical", code: "CAS_COURSE_MISMATCH", field: "course", message: `CAS course "${cas.fields.course}" does not match the case programme "${refs.programmeName}". CAS details must match the application exactly.`, documentIds: [cas.documentId] });
    }
    const fee = Number(cas.fields.tuitionFee);
    if (refs.tuitionFee && Number.isFinite(fee) && Math.abs(fee - refs.tuitionFee) > 1) {
      flags.push({ severity: "critical", code: "CAS_FEE_MISMATCH", field: "tuitionFee", message: `CAS tuition (${fee}) differs from case tuition (${refs.tuitionFee}). Funds calculation and application must use the CAS figure.`, documentIds: [cas.documentId] });
    }
    const start = normaliseDate(cas.fields.startDate);
    if (refs.intakeStartDate && start && Math.abs(daysBetween(start, refs.intakeStartDate)) > 31) {
      flags.push({ severity: "warning", code: "CAS_DATE_MISMATCH", field: "startDate", message: `CAS start date ${start} differs from case intake start ${refs.intakeStartDate}.`, documentIds: [cas.documentId] });
    }
  }

  // SOP must refer to the case university/programme
  const sop = docs.find((d) => d.docType === "sop");
  if (sop && refs.universityName && typeof sop.fields.universityMentioned === "string" && sop.fields.universityMentioned && !textSimilar(sop.fields.universityMentioned, refs.universityName)) {
    flags.push({ severity: "critical", code: "SOP_WRONG_UNIVERSITY", field: "universityMentioned", message: `SOP names "${sop.fields.universityMentioned}" but this case is for "${refs.universityName}". A recycled SOP is a common credibility refusal reason — NEEDS MANUAL VERIFICATION.`, documentIds: [sop.documentId] });
  }

  // Bank statement holder should be the student or a declared sponsor
  for (const bs of docs.filter((d) => d.docType === "bank_statement")) {
    const holder = bs.fields.accountHolder;
    if (typeof holder !== "string" || !holder) continue;
    const candidates = [profileName, ...student.sponsors.map((s) => s.name)];
    if (!candidates.some((c) => compareNames(c, holder) !== "mismatch")) {
      flags.push({ severity: "critical", code: "ACCOUNT_HOLDER_UNKNOWN", field: "accountHolder", message: `Bank statement holder "${holder}" is not the student or a declared sponsor. Funds must demonstrably belong to the student/family — NEEDS MANUAL VERIFICATION.`, documentIds: [bs.documentId] });
    }
  }

  return flags;
}

// ---------- single-document checks ----------

export interface CompletenessResult {
  allPages: boolean;
  legible: boolean;
  notExpired: boolean;
  correctType: boolean;
  notes: string[];
  flags: Omit<DocumentFlag, "id">[];
}

export function documentChecks(d: DocFields, opts: { courseEndDate?: string; today?: string } = {}): CompletenessResult {
  const today = opts.today ?? todayISO();
  const notes: string[] = [];
  const flags: Omit<DocumentFlag, "id">[] = [];
  const statedPages = Number(d.fields.totalPagesStated);
  const allPages = !(Number.isFinite(statedPages) && d.pagesDetected != null && d.pagesDetected < statedPages);
  if (!allPages) {
    notes.push(`Only ${d.pagesDetected} of ${statedPages} pages present.`);
    flags.push({ severity: "warning", code: "MISSING_PAGES", message: `Document states ${statedPages} pages but ${d.pagesDetected} were uploaded. Request the complete document.`, needsManualVerification: true });
  }
  const legible = d.legible !== false;
  if (!legible) {
    notes.push("Parts of the document are not legible.");
    flags.push({ severity: "warning", code: "ILLEGIBLE", message: "Document is not fully legible. Request a clearer scan.", needsManualVerification: true });
  }
  const correctType = !d.detectedDocType || d.detectedDocType === d.docType || d.detectedDocType === "other";
  if (!correctType) {
    notes.push(`Looks like a ${d.detectedDocType}, uploaded as ${d.docType}.`);
    flags.push({ severity: "critical", code: "WRONG_TYPE", message: `This file appears to be a "${d.detectedDocType}" but was uploaded as "${d.docType}". NEEDS MANUAL VERIFICATION.`, needsManualVerification: true });
  }
  let notExpired = true;
  const exp = normaliseDate(d.expiryDate ?? d.fields.expiryDate);
  if (exp) {
    if (isBefore(exp, today)) {
      notExpired = false;
      notes.push(`Expired on ${exp}.`);
      flags.push({ severity: "critical", code: "EXPIRED", message: `${d.label} expired on ${exp}.`, needsManualVerification: false });
    } else if (d.docType === "passport" && opts.courseEndDate && isBefore(exp, addDays(opts.courseEndDate, 0))) {
      notes.push(`Passport expires ${exp}, before course end ${opts.courseEndDate}.`);
      flags.push({ severity: "warning", code: "PASSPORT_EXPIRES_DURING_COURSE", message: `Passport expires ${exp}, before the course ends (${opts.courseEndDate}). Renew before filing the visa.`, needsManualVerification: false });
    } else if (daysBetween(today, exp) < 90) {
      flags.push({ severity: "warning", code: "EXPIRING_SOON", message: `${d.label} expires in ${daysBetween(today, exp)} days (${exp}).`, needsManualVerification: false });
    }
  }
  if (d.injectionSuspected) {
    flags.push({ severity: "warning", code: "INSTRUCTION_TEXT", message: "Document contains instruction-like text (e.g. 'ignore previous instructions'). It was treated as data only. NEEDS MANUAL VERIFICATION.", needsManualVerification: true });
  }
  return { allPages, legible, notExpired, correctType, notes, flags };
}
