// Demo data: 6 realistic scenarios + 1 lead. Uses the REAL services for consistency checks,
// financial analysis, eligibility and the blocked gate attempts, so what you see in the demo is
// exactly what the engine produces.

import { PDFDocument, StandardFonts } from "pdf-lib";
import { COUNTRIES } from "@/domain/countries";
import { addDays, todayISO } from "@/domain/dates";
import { GateError } from "@/domain/gates";
import type {
  Approval,
  Attestation,
  AttestationStep,
  BankTransaction,
  Case,
  CountryCheckState,
  DocType,
  DocumentRecord,
  EducationRecord,
  ExtractedFields,
  Organization,
  Payment,
  Stage,
  Student,
  User,
} from "@/domain/types";
import { STAGES } from "@/domain/types";
import { MockProvider } from "../ai/mock";
import type { Actor } from "../auth/session";
import { COLLECTIONS, type Repo, firebaseConfigured } from "../db";
import { putFile, wipeLocalUploads } from "../storage";
import { audit } from "../services/audit";
import { buildAttestations } from "../services/cases";
import { recomputeConsistency } from "../services/documents";
import { recomputeEligibility } from "../services/eligibility";
import { analyzeFromDocument } from "../services/financial";
import { startPreflight, transitionCase } from "../services/gates";
import { syncTasks } from "../services/tasks";
import { materialiseProgrammes } from "./programmes.seed";
import { materialiseRules } from "./rules.seed";

export { DEMO_ORG } from "./constants";
import { DEMO_ORG } from "./constants";
const T = todayISO();
const d = (n: number) => addDays(T, n);
const NOW = () => new Date().toISOString();

const USERS: Omit<User, "createdAt" | "updatedAt" | "organizationId">[] = [
  { id: "us_owner", email: "owner@demo.visaguard.app", name: "Ayesha Malik", role: "owner", active: true },
  { id: "us_manager", email: "manager@demo.visaguard.app", name: "Bilal Ahmed", role: "manager", active: true },
  { id: "us_officer", email: "officer@demo.visaguard.app", name: "Sana Riaz", role: "officer", active: true },
  { id: "us_officer2", email: "officer2@demo.visaguard.app", name: "Usman Tariq", role: "officer", active: true },
  { id: "us_counsellor", email: "counsellor@demo.visaguard.app", name: "Hira Khan", role: "counsellor", active: true },
];

function actorOf(u: (typeof USERS)[number]): Actor {
  return { id: u.id, name: u.name, email: u.email, role: u.role, organizationId: DEMO_ORG };
}

function edu(level: EducationRecord["level"], institution: string, program: string | undefined, start: string, end: string, gradeType: EducationRecord["gradeType"], obtained: number, total: number, extra: Partial<EducationRecord> = {}): EducationRecord {
  return { id: `ed_${level}_${Math.random().toString(36).slice(2, 7)}`, level, institution, program, field: program, startDate: start, endDate: end, gradeType, obtained, total, completed: true, ...extra };
}

function student(id: string, p: Partial<Student> & { personal: Student["personal"] }): Student {
  const now = NOW();
  return {
    id,
    organizationId: DEMO_ORG,
    createdAt: now,
    updatedAt: now,
    education: [],
    gaps: [],
    englishTests: [],
    work: [],
    sponsors: [],
    budget: {},
    intended: { countries: [] },
    refusals: [],
    travel: [],
    consent: { given: true, at: now, by: "Hira Khan", version: "2026-10-v1" },
    counsellorId: "us_counsellor",
    portalUserId: `us_${id}`,
    ...p,
  };
}

function history(upTo: Stage): Case["stageHistory"] {
  const idx = STAGES.indexOf(upTo);
  return STAGES.slice(0, idx + 1).map((stage, i) => ({ stage, at: addDays(T, -6 * (idx - i) - 2) + "T10:00:00.000Z", by: i === 4 ? "Bilal Ahmed" : "Sana Riaz" }));
}

function checks(country: Case["country"], states: Record<string, CountryCheckState["status"]>, dates: Record<string, string> = {}): Case["countryChecks"] {
  return Object.fromEntries(COUNTRIES[country].checks.map((c) => [c.key, { status: states[c.key] ?? "not_started", date: dates[c.key] }]));
}

async function samplePdf(title: string, lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText("SAMPLE DEMO FILE - NOT A REAL DOCUMENT", { x: 48, y: 790, size: 11, font: bold });
  page.drawText(title, { x: 48, y: 760, size: 16, font: bold });
  lines.forEach((l, i) => page.drawText(l.replace(/[^\x20-\x7E]/g, "?").slice(0, 90), { x: 48, y: 730 - i * 16, size: 10, font }));
  return Buffer.from(await pdf.save());
}

interface DocSpec {
  type: DocType;
  caseId?: string;
  fields?: Record<string, string | number | null>;
  transactions?: BankTransaction[];
  review?: DocumentRecord["reviewStatus"];
}

async function addDocs(repo: Repo, s: Student, specs: DocSpec[]) {
  const mock = new MockProvider();
  for (const spec of specs) {
    const id = `dc_${s.id}_${spec.type}`;
    const fileName = `${spec.type}_${s.personal.fullName.split(" ")[0].toLowerCase()}.pdf`;
    const base = await mock.extract({ docType: spec.type, bytes: Buffer.from(""), mimeType: "application/pdf", fileName, student: s });
    const fields = { ...base.fields, ...(spec.fields ?? {}) };
    const bytes = await samplePdf(`${spec.type.toUpperCase()} - ${s.personal.fullName}`, Object.entries(fields).map(([k, v]) => `${k}: ${v ?? ""}`));
    const storagePath = `orgs/${DEMO_ORG}/students/${s.id}/${id}/${fileName}`;
    await putFile(storagePath, bytes, "application/pdf");
    const now = NOW();
    const doc: DocumentRecord = {
      id,
      organizationId: DEMO_ORG,
      createdAt: now,
      updatedAt: now,
      studentId: s.id,
      caseId: spec.caseId,
      docType: spec.type,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      storagePath,
      uploadedBy: "us_officer",
      uploadedVia: "seed",
      pageCount: 1,
      extractionStatus: "done",
      extractedFieldsId: `ef_${id}`,
      flags: [],
      reviewStatus: spec.review ?? "verified",
      reviewedBy: spec.review === "pending" ? undefined : "Sana Riaz",
      reviewedAt: spec.review === "pending" ? undefined : now,
    };
    const ef: ExtractedFields = {
      id: `ef_${id}`,
      organizationId: DEMO_ORG,
      createdAt: now,
      updatedAt: now,
      documentId: id,
      studentId: s.id,
      docType: spec.type,
      fields,
      fieldConfidence: Object.fromEntries(Object.keys(fields).map((k) => [k, "high" as const])),
      detectedDocType: spec.type,
      pagesDetected: 1,
      legible: true,
      expiryDate: base.expiryDate,
      source: "seed",
      model: "seed",
      promptVersion: "seed",
      transactions: spec.transactions,
    };
    await repo.set("documents", id, doc);
    await repo.set("extractedFields", ef.id, ef);
  }
}

/** Build a statement from a starting balance and dated events; returns opening, txs. */
function statement(start: string, end: string, opening: number, events: { day: number; amount: number; description: string }[]): { opening: number; transactions: BankTransaction[] } {
  let bal = opening;
  const transactions: BankTransaction[] = [];
  for (const e of [...events].sort((a, b) => a.day - b.day)) {
    const date = addDays(start, e.day);
    if (date > end) continue;
    bal = Math.round((bal + e.amount) * 100) / 100;
    transactions.push({ date, description: e.description, amount: e.amount, balance: bal });
  }
  return { opening, transactions };
}

const BASE_DOCS: DocType[] = ["passport", "cnic", "matric", "intermediate", "degree", "transcript", "english_test", "sop", "cv"];

export async function wipeDemo(repo: Repo) {
  if (!firebaseConfigured()) {
    await repo.wipe();
    wipeLocalUploads();
    return;
  }
  for (const c of COLLECTIONS) {
    const rows = await repo.list<{ id: string }>(c, [["organizationId", "==", DEMO_ORG]]);
    for (const r of rows) await repo.delete(c, r.id);
  }
  await repo.delete("auditHeads", DEMO_ORG);
  await repo.delete("organizations", DEMO_ORG);
}

export async function seedDemo(repo: Repo): Promise<{ cases: number }> {
  await wipeDemo(repo);
  const now = NOW();
  const org: Organization = { id: DEMO_ORG, name: "Crescent Study Consultants (Demo)", createdAt: now, updatedAt: now, demo: true, defaultCurrency: "PKR" };
  await repo.set("organizations", org.id, { ...org, organizationId: org.id });
  for (const u of USERS) await repo.set<User>("users", u.id, { ...u, organizationId: DEMO_ORG, createdAt: now, updatedAt: now });
  const rules = materialiseRules(DEMO_ORG, "Bilal Ahmed");
  for (const r of rules) await repo.set("rules", r.id, r);
  const { universities, programmes } = materialiseProgrammes(DEMO_ORG);
  for (const u of universities) await repo.set("universities", u.id, u);
  for (const p of programmes) await repo.set("programmes", p.id, p);

  const officer = actorOf(USERS[2]);
  const officer2 = actorOf(USERS[3]);

  // ---------------- Students ----------------
  const S: Student[] = [
    student("st_hamza", {
      personal: { fullName: "Hamza Iqbal", givenNames: "Hamza", surname: "Iqbal", fatherName: "Muhammad Iqbal", dob: "2001-04-12", gender: "male", cnic: "35202-1234567-1", passportNumber: "AB1234561", passportExpiry: "2031-03-01", nationality: "Pakistani", city: "Lahore", phone: "+92 300 1112233", email: "hamza.iqbal@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "Govt. High School Model Town", undefined, "2015-04-01", "2017-05-31", "percentage", 890, 1100, { board: "BISE Lahore" }),
        edu("intermediate", "Punjab Group of Colleges", "FSc Pre-Engineering", "2017-08-01", "2019-06-30", "percentage", 870, 1100, { board: "BISE Lahore" }),
        edu("bachelor", "Punjab Institute of Technology", "BS Computer Science", "2019-09-01", "2023-07-15", "cgpa", 2.45, 4, { field: "Computer Science", backlogs: 2 }),
      ],
      englishTests: [{ id: "en_hamza", type: "IELTS", overall: 6.5, listening: 6.5, reading: 6.5, writing: 6, speaking: 6.5, testDate: "2026-05-10" }],
      work: [{ id: "wk_hamza", employer: "Techverse Solutions", title: "Junior Web Developer", from: "2023-09-01" }],
      sponsors: [{ id: "sp_hamza", name: "Muhammad Iqbal", relation: "Father", occupation: "Shop owner", annualIncomePKR: 4_800_000 }],
      budget: { totalPKR: 9_000_000 },
      intended: { level: "master", field: "Data Science", intake: "2027-01", countries: ["UK"] },
      tiesToPakistan: "Family business in Lahore; employer has offered a senior role on return.",
    }),
    student("st_ayesha", {
      personal: { fullName: "Ayesha Noor", givenNames: "Ayesha", surname: "Noor", fatherName: "Tariq Noor", dob: "2000-09-03", gender: "female", cnic: "33100-7654321-2", passportNumber: "CK7654321", passportExpiry: "2032-02-10", nationality: "Pakistani", city: "Faisalabad", phone: "+92 321 4445566", email: "ayesha.noor@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "Allied School Faisalabad", undefined, "2014-04-01", "2016-05-31", "percentage", 1010, 1100, { board: "BISE Faisalabad" }),
        edu("intermediate", "Punjab College Faisalabad", "FSc Pre-Medical", "2016-08-01", "2018-06-30", "percentage", 940, 1100, { board: "BISE Faisalabad" }),
        edu("bachelor", "Lahore College of Sciences", "BS Biotechnology", "2018-09-01", "2022-07-15", "cgpa", 3.25, 4, { field: "Biotechnology" }),
      ],
      englishTests: [{ id: "en_ayesha", type: "IELTS", overall: 7, listening: 7.5, reading: 7, writing: 6.5, speaking: 7, testDate: "2026-03-14" }],
      work: [{ id: "wk_ayesha", employer: "Faisalabad District Health Lab", title: "Laboratory Assistant", from: "2022-08-01", to: "2026-06-30" }],
      sponsors: [{ id: "sp_ayesha", name: "Tariq Noor", relation: "Father", occupation: "Civil servant (BPS-19)", annualIncomePKR: 3_600_000 }],
      budget: { totalPKR: 10_500_000 },
      intended: { level: "master", field: "Public Health", intake: "2027-01", countries: ["UK"] },
      tiesToPakistan: "Lien on government lab post; family home in Faisalabad.",
    }),
    student("st_ali", {
      personal: { fullName: "Muhammad Ali Raza", givenNames: "Muhammad Ali", surname: "Raza", fatherName: "Raza Hussain", dob: "1999-12-20", gender: "male", cnic: "37405-2345678-3", passportNumber: "FM2345678", passportExpiry: "2030-06-15", nationality: "Pakistani", city: "Rawalpindi", phone: "+92 333 7778899", email: "ali.raza@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "F.G. Boys School", undefined, "2013-04-01", "2015-05-31", "percentage", 935, 1100, { board: "FBISE Islamabad" }),
        edu("intermediate", "F.G. Sir Syed College", "ICS", "2015-08-01", "2017-06-30", "percentage", 880, 1100, { board: "FBISE Islamabad" }),
        edu("bachelor", "Federal Institute of Engineering & Technology", "BS Computer Science", "2017-09-01", "2021-07-15", "cgpa", 3.1, 4, { field: "Computer Science" }),
      ],
      englishTests: [{ id: "en_ali", type: "IELTS", overall: 6.5, listening: 7, reading: 6.5, writing: 6, speaking: 6.5, testDate: "2026-07-02" }],
      work: [{ id: "wk_ali", employer: "Systems Pvt Ltd", title: "Software Engineer", from: "2021-09-01" }],
      sponsors: [{ id: "sp_ali", name: "Raza Hussain", relation: "Father", occupation: "Retired army officer", annualIncomePKR: 2_900_000 }],
      budget: { totalPKR: 7_000_000 },
      intended: { level: "master", field: "Computer Science", intake: "2027-04", countries: ["DE"] },
      tiesToPakistan: "Parents in Rawalpindi depend on him; plans to return to a tech lead role.",
    }),
    student("st_fatima", {
      personal: { fullName: "Fatima Zahra", givenNames: "Fatima", surname: "Zahra", fatherName: "Abdul Rehman", dob: "2001-02-14", gender: "female", cnic: "35201-3456789-4", passportNumber: "GH3456789", passportExpiry: "2031-09-30", nationality: "Pakistani", city: "Lahore", phone: "+92 345 1212121", email: "fatima.zahra@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "Lahore Grammar School", undefined, "2015-04-01", "2017-05-31", "percentage", 980, 1100, { board: "BISE Lahore" }),
        edu("intermediate", "Kinnaird College", "ICS", "2017-08-01", "2019-06-30", "percentage", 905, 1100, { board: "BISE Lahore" }),
        edu("bachelor", "University of Central Punjab Sciences", "BS Software Engineering", "2019-09-01", "2023-07-15", "cgpa", 3.05, 4, { field: "Software Engineering" }),
      ],
      englishTests: [{ id: "en_fatima", type: "IELTS", overall: 6.5, listening: 7, reading: 6.5, writing: 6, speaking: 6.5, testDate: "2026-04-20" }],
      work: [{ id: "wk_fatima", employer: "Netsol Digital", title: "QA Engineer", from: "2023-09-01", to: "2026-08-31" }],
      sponsors: [{ id: "sp_fatima", name: "Abdul Rehman", relation: "Father", occupation: "Textile wholesaler", annualIncomePKR: 5_500_000 }],
      budget: { totalPKR: 6_000_000 },
      intended: { level: "master", field: "Computer Engineering", intake: "2026-11", countries: ["IT"] },
      tiesToPakistan: "Family business; elder siblings in Lahore.",
    }),
    student("st_zainab", {
      personal: { fullName: "Zainab Hussain", givenNames: "Zainab", surname: "Hussain", fatherName: "Syed Hussain Shah", dob: "2000-07-07", gender: "female", cnic: "42101-4567890-6", passportNumber: "KL4567890", passportExpiry: "2033-01-20", nationality: "Pakistani", city: "Karachi", phone: "+92 302 3434343", email: "zainab.hussain@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "Karachi Grammar School", undefined, "2014-04-01", "2016-05-31", "percentage", 990, 1100, { board: "BSEK Karachi" }),
        edu("intermediate", "D.J. Science College", "Pre-Engineering", "2016-08-01", "2018-06-30", "percentage", 930, 1100, { board: "BIEK Karachi" }),
        edu("bachelor", "National University of Modern Computing", "BS Computer Science", "2018-09-01", "2022-06-30", "cgpa", 3.45, 4, { field: "Computer Science" }),
      ],
      englishTests: [{ id: "en_zainab", type: "IELTS", overall: 7, listening: 7.5, reading: 7, writing: 6.5, speaking: 7, testDate: "2026-02-18" }],
      work: [{ id: "wk_zainab", employer: "Careem Engineering", title: "Data Analyst", from: "2022-08-01", to: "2026-09-30" }],
      sponsors: [{ id: "sp_zainab", name: "Syed Hussain Shah", relation: "Father", occupation: "Chartered accountant", annualIncomePKR: 7_200_000 }],
      budget: { totalPKR: 8_000_000 },
      intended: { level: "master", field: "Computer Science", intake: "2027-01", countries: ["FR"] },
      tiesToPakistan: "Returning offer from previous employer; family property in Karachi.",
    }),
    student("st_omar", {
      personal: { fullName: "Omar Farooq", givenNames: "Omar", surname: "Farooq", fatherName: "Farooq Ahmed", dob: "2001-11-30", gender: "male", cnic: "37406-5678901-7", passportNumber: "PQ5678901", passportExpiry: "2032-08-01", nationality: "Pakistani", city: "Islamabad", phone: "+92 311 5656565", email: "omar.farooq@example.com", maritalStatus: "single" },
      education: [
        edu("matric", "Islamabad Model School", undefined, "2016-04-01", "2018-05-31", "percentage", 1000, 1100, { board: "FBISE Islamabad" }),
        edu("intermediate", "Islamabad College for Boys", "FSc Pre-Engineering", "2018-08-01", "2020-06-30", "percentage", 950, 1100, { board: "FBISE Islamabad" }),
        edu("bachelor", "Institute of Engineering Sciences Taxila", "BS Mechanical Engineering", "2020-09-01", "2026-06-30", "cgpa", 3.4, 4, { field: "Mechanical Engineering" }),
      ],
      englishTests: [{ id: "en_omar", type: "IELTS", overall: 7, listening: 7.5, reading: 7, writing: 6.5, speaking: 7, testDate: "2026-08-15" }],
      sponsors: [{ id: "sp_omar", name: "Farooq Ahmed", relation: "Father", occupation: "Pharmaceutical distributor", annualIncomePKR: 9_000_000 }],
      budget: { totalPKR: 12_000_000 },
      intended: { level: "master", field: "Engineering Management", intake: "2027-01", countries: ["UK"] },
      tiesToPakistan: "Will join the family pharmaceutical distribution business in Islamabad.",
    }),
    student("st_saad", {
      personal: { fullName: "Saad Khan", nationality: "Pakistani", phone: "+92 300 9090909", email: "saad.khan@example.com" },
      intended: { level: "bachelor", countries: ["UK", "DE"] },
      consent: { given: false },
      portalUserId: undefined,
      intakeToken: "demo-intake-link-saad-khan-2026",
      intakeTokenExpiresAt: addDays(T, 30) + "T00:00:00.000Z",
    }),
  ];
  for (const s of S) await repo.set("students", s.id, s);
  for (const s of S.filter((x) => x.portalUserId)) {
    await repo.set<User>("users", s.portalUserId!, { id: s.portalUserId!, organizationId: DEMO_ORG, createdAt: now, updatedAt: now, email: s.personal.email!, name: s.personal.fullName, role: "student", active: true, studentId: s.id });
  }

  // ---------------- Cases ----------------
  const mk = (id: string, s: Student, p: Partial<Case> & Pick<Case, "country" | "universityName" | "programmeName" | "intake" | "intakeStartDate" | "courseMonths" | "tuitionFee" | "stage">): Case => ({
    id,
    organizationId: DEMO_ORG,
    createdAt: now,
    updatedAt: now,
    studentId: s.id,
    studentName: s.personal.fullName,
    level: "master",
    tuitionPaid: 0,
    stageHistory: history(p.stage),
    assignedOfficerId: "us_officer",
    counsellorId: "us_counsellor",
    countryChecks: checks(p.country, {}),
    dataVersion: 1,
    ...p,
  });

  const C: Case[] = [
    mk("cs_1_lowcgpa", S[0], { demoTag: "1. Low CGPA → blocked at gate (the real incident)", country: "UK", programmeId: "pg_UK_1", universityName: "Northbridge University", programmeName: "MSc Data Science", programmeField: "Data Science", city: "London", inLondon: true, intake: "2027-01", intakeStartDate: "2027-01-25", applicationDeadline: "2026-12-01", courseMonths: 12, tuitionFee: { amount: 19500, currency: "GBP" }, minCGPA4: 3.0, englishRequirement: { ielts: 6.5, pte: 64 }, stage: "Docs Verified" }),
    mk("cs_2_funds", S[1], {
      demoTag: "2. UK funds dip below requirement on day 19",
      country: "UK", programmeId: "pg_UK_4", universityName: "Harrowgate University", programmeName: "MSc Public Health", programmeField: "Public Health", city: "Leeds", inLondon: false, intake: "2027-01", intakeStartDate: "2027-01-25", applicationDeadline: "2026-12-01", plannedVisaApplicationDate: d(5), courseMonths: 12, tuitionFee: { amount: 17000, currency: "GBP" }, tuitionPaid: 5000, minCGPA4: 2.7, englishRequirement: { ielts: 6.5 }, stage: "Offer/Admission",
      offer: { type: "unconditional", receivedAt: d(-20), reference: "HU-27-0412" },
      cas: { name: "Ayesha Noor", course: "MSc Public Health", tuitionFee: 17000, startDate: "2027-01-25" },
      countryChecks: checks("UK", { cas_issued: "complete", tb_certificate: "complete", pre_cas_interview: "complete" }, { cas_issued: d(-6), tb_certificate: d(-15), pre_cas_interview: d(-12) }),
    }),
    mk("cs_3_germany", S[2], {
      demoTag: "3. Germany: APS missing, attestation chain too slow", country: "DE", programmeId: "pg_DE_1", universityName: "TU Rheinfeld", programmeName: "MSc Computer Science", programmeField: "Computer Science", city: "Rheinfeld", intake: "2027-04", intakeStartDate: "2027-04-01", applicationDeadline: "2027-01-15", courseMonths: 24, tuitionFee: { amount: 1400, currency: "EUR" }, minGermanGrade: 2.5, englishRequirement: { ielts: 6.5 }, stage: "Profile Complete", assignedOfficerId: "us_officer2",
      countryChecks: checks("DE", { admission_route: "in_progress" }),
    }),
    mk("cs_4_italy", S[3], {
      demoTag: "4. Italy: Universitaly not validated, no DoV/CIMEA, unexplained deposit", country: "IT", programmeId: "pg_IT_1", universityName: "University of Valcorso", programmeName: "MSc Computer Engineering", programmeField: "Computer Engineering", city: "Milan", intake: "2026-11", intakeStartDate: "2026-11-16", plannedVisaApplicationDate: d(14), courseMonths: 24, tuitionFee: { amount: 7800, currency: "EUR" }, minCGPA4: 2.8, englishRequirement: { ielts: 6.0, moiAccepted: true }, stage: "Offer/Admission", assignedOfficerId: "us_officer2",
      offer: { type: "conditional", receivedAt: d(-25), reference: "UNIVAL-PRE-2026-118" },
      countryChecks: checks("IT", { universitaly_validated: "in_progress", translation_legalisation: "in_progress", health_insurance: "complete", visa_appointment: "complete" }, { health_insurance: d(-4), visa_appointment: d(14) }),
    }),
    mk("cs_5_france", S[4], {
      demoTag: "5. France: clean file, AMBER because funds rule is Conflicting", country: "FR", programmeId: "pg_FR_1", universityName: "Université de Montclar", programmeName: "Master in Computer Science (English-taught)", programmeField: "Computer Science", city: "Lyon", intake: "2027-01", intakeStartDate: "2027-01-11", plannedVisaApplicationDate: d(10), courseMonths: 24, tuitionFee: { amount: 7758, currency: "EUR" }, minCGPA4: 2.8, englishRequirement: { ielts: 6.5 }, stage: "Offer/Admission",
      offer: { type: "unconditional", receivedAt: d(-30), reference: "MONTCLAR-M1-2027-77" },
      countryChecks: checks("FR", { eef_file: "complete", campus_france_interview: "complete", accommodation_proof: "complete", health_insurance: "complete" }, { eef_file: d(-40), campus_france_interview: d(-6), accommodation_proof: d(-5), health_insurance: d(-5) }),
    }),
    mk("cs_6_green", S[5], { demoTag: "6. All-GREEN reference case (try the pre-flight)", country: "UK", programmeId: "pg_UK_6", universityName: "Caledon University", programmeName: "MSc Engineering Management", programmeField: "Engineering Management", city: "Manchester", inLondon: false, intake: "2027-01", intakeStartDate: "2027-01-25", applicationDeadline: "2026-12-01", plannedVisaApplicationDate: d(20), courseMonths: 12, tuitionFee: { amount: 15500, currency: "GBP" }, minCGPA4: 2.5, englishRequirement: { ielts: 6.0, moiAccepted: true }, stage: "Manager Approved" }),
  ];
  for (const c of C) await repo.set("cases", c.id, c);

  // ---------------- Attestations ----------------
  const atts = (c: Case, steps: Record<string, Partial<Record<string, Partial<AttestationStep>>>>) =>
    buildAttestations(c, rules).map((a): Attestation => ({ ...a, id: `at_${c.id}_${a.documentLabel.split(" ")[0].toLowerCase()}`, steps: a.steps.map((s) => ({ ...s, ...(steps[a.documentLabel]?.[s.authority] ?? {}) })) }));
  const allAtt: Attestation[] = [
    ...atts(C[2], { "School certificates": { BOARD: { status: "completed", submittedAt: d(-55), completedAt: d(-40) }, IBCC: { status: "completed", submittedAt: d(-38), completedAt: d(-25) }, MOFA: { status: "in_progress", submittedAt: d(-3) } } }),
    ...atts(C[3], { "School certificates": { BOARD: { status: "completed", completedAt: d(-90) }, IBCC: { status: "completed", completedAt: d(-75) }, MOFA: { status: "completed", completedAt: d(-60) }, TRANSLATION: { status: "completed", completedAt: d(-50) } }, "Degree & transcript": { HEC: { status: "completed", completedAt: d(-45) }, MOFA: { status: "completed", completedAt: d(-35) }, TRANSLATION: { status: "in_progress", submittedAt: d(-2) } } }),
    ...atts(C[4], { "Degree & transcript": { HEC: { status: "completed", completedAt: d(-70) }, MOFA: { status: "completed", completedAt: d(-60) } } }),
  ];
  for (const a of allAtt) await repo.set("attestations", a.id, a);

  // ---------------- Documents ----------------
  await addDocs(repo, S[0], BASE_DOCS.map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "Northbridge University", programmeMentioned: "MSc Data Science" } : undefined })));

  // Ayesha: statement with a dip on day 19 of the 28-day window
  {
    const end = d(-2);
    const start = d(-60);
    // window = 28 days ending on `end`; day k of the window is (60 - 2 - 27) + (k - 1) days after `start`
    const off = (dayOfWindow: number) => 60 - 2 - 27 + (dayOfWindow - 1);
    const st = statement(start, end, 9_150_000, [
      { day: 5, amount: 300_000, description: "Salary credit - Govt of Punjab" },
      { day: 12, amount: -85_000, description: "Utility bills" },
      { day: 35, amount: 300_000, description: "Salary credit - Govt of Punjab" },
      { day: off(19), amount: -1_450_000, description: "Cash withdrawal - family wedding" },
      { day: off(22), amount: 1_450_000, description: "Cash deposit - returned by family" },
    ]);
    await addDocs(repo, S[1], [
      ...BASE_DOCS.map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "Harrowgate University", programmeMentioned: "MSc Public Health" } : undefined })),
      { type: "photo" },
      { type: "offer_letter", fields: { universityName: "Harrowgate University", programme: "MSc Public Health", offerType: "unconditional" } },
      { type: "cas", fields: { fullName: "Ayesha Noor", casNumber: "E4G7H2K9L0M3N5", course: "MSc Public Health", tuitionFee: 17000, tuitionPaid: 5000, startDate: "2027-01-25", passportNumber: "CK7654321", dob: "2000-09-03" } },
      { type: "medical_tb", fields: { passportNumber: "CK7654321", clinic: "IOM Islamabad (approved clinic)", issueDate: d(-15), expiryDate: addDays(d(-15), 180), result: "No TB detected" } },
      { type: "bank_statement", fields: { accountHolder: "Tariq Noor", bankName: "Sample Bank Ltd", currency: "PKR", statementStart: start, statementEnd: end, openingBalance: st.opening }, transactions: st.transactions },
      { type: "sponsor_letter" },
      { type: "sponsor_income", fields: { sponsorName: "Tariq Noor", incomeType: "Salary certificate + tax return", annualIncome: 3_600_000, currency: "PKR" } },
    ]);
  }

  await addDocs(repo, S[2], BASE_DOCS.map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "TU Rheinfeld", programmeMentioned: "MSc Computer Science" } : undefined })));

  // Fatima: name variant on intermediate + an unexplained large deposit
  {
    const start = d(-95);
    const end = d(-3);
    const ev = [] as { day: number; amount: number; description: string }[];
    for (let m = 0; m < 3; m++) ev.push({ day: 3 + m * 30, amount: 180_000, description: "Business income transfer" }, { day: 15 + m * 30, amount: -160_000, description: "Household expenses" });
    ev.push({ day: 83, amount: 3_500_000, description: "IBFT from M/S Kashif Traders" });
    const st = statement(start, end, 1_420_000, ev);
    await addDocs(repo, S[3], [
      ...BASE_DOCS.filter((t) => t !== "intermediate").map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "University of Valcorso", programmeMentioned: "MSc Computer Engineering" } : undefined })),
      { type: "intermediate", fields: { fullName: "Fatima Zehra" } },
      { type: "photo" },
      { type: "offer_letter", fields: { universityName: "University of Valcorso", programme: "MSc Computer Engineering", offerType: "conditional" } },
      { type: "health_insurance", fields: { passportNumber: "GH3456789", insurer: "Sample Assicurazioni", startDate: "2026-11-10", expiryDate: "2027-11-09" } },
      { type: "bank_statement", fields: { accountHolder: "Abdul Rehman", bankName: "Sample Bank Ltd", currency: "PKR", statementStart: start, statementEnd: end, openingBalance: st.opening }, transactions: st.transactions },
      { type: "sponsor_letter" },
      { type: "sponsor_income", fields: { sponsorName: "Abdul Rehman", incomeType: "Business tax return 2025", annualIncome: 5_500_000, currency: "PKR" } },
    ]);
  }

  // Zainab: clean
  {
    const start = d(-90);
    const end = d(-4);
    const ev = [0, 1, 2].map((m) => ({ day: 1 + m * 30, amount: 250_000, description: "Salary - Syed Hussain Shah & Co." }));
    const st = statement(start, end, 4_300_000, ev);
    await addDocs(repo, S[4], [
      ...BASE_DOCS.map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "Université de Montclar", programmeMentioned: "Master in Computer Science" } : undefined })),
      { type: "photo" },
      { type: "offer_letter", fields: { universityName: "Université de Montclar", programme: "Master in Computer Science", offerType: "unconditional" } },
      { type: "accommodation", fields: { address: "Résidence Universitaire, Lyon", startDate: "2027-01-05", endDate: "2027-12-31" } },
      { type: "health_insurance", fields: { passportNumber: "KL4567890", insurer: "Sample Santé", startDate: "2027-01-05", expiryDate: "2028-01-04" } },
      { type: "bank_statement", fields: { accountHolder: "Syed Hussain Shah", bankName: "Sample Bank Ltd", currency: "PKR", statementStart: start, statementEnd: end, openingBalance: st.opening }, transactions: st.transactions },
      { type: "sponsor_letter" },
      { type: "sponsor_income", fields: { sponsorName: "Syed Hussain Shah", incomeType: "Tax return 2025 + firm letter", annualIncome: 7_200_000, currency: "PKR" } },
    ]);
  }

  // Omar: GREEN
  {
    const start = d(-60);
    const end = d(-1);
    const st = statement(start, end, 11_400_000, [
      { day: 10, amount: 400_000, description: "Distribution income - Farooq Pharma" },
      { day: 24, amount: -150_000, description: "Household expenses" },
      { day: 40, amount: 400_000, description: "Distribution income - Farooq Pharma" },
      { day: 50, amount: -120_000, description: "Household expenses" },
    ]);
    await addDocs(repo, S[5], [
      ...BASE_DOCS.map((type) => ({ type, fields: type === "sop" ? { universityMentioned: "Caledon University", programmeMentioned: "MSc Engineering Management" } : undefined })),
      { type: "bank_statement", fields: { accountHolder: "Farooq Ahmed", bankName: "Sample Bank Ltd", currency: "PKR", statementStart: start, statementEnd: end, openingBalance: st.opening }, transactions: st.transactions },
      { type: "sponsor_letter" },
      { type: "sponsor_income", fields: { sponsorName: "Farooq Ahmed", incomeType: "Business tax return 2025", annualIncome: 9_000_000, currency: "PKR" } },
    ]);
  }

  // ---------------- Historical payments (already authorised through pre-flight) ----------------
  const pay = async (id: string, c: Case, type: Payment["type"], amount: number, currency: Payment["currency"], amountPKR: number, refundable: boolean, description: string) => {
    let approvalId: string | undefined;
    if (!refundable) {
      approvalId = `ap_hist_${id}`;
      const ap: Approval = { id: approvalId, organizationId: DEMO_ORG, createdAt: addDays(T, -21) + "T10:00:00Z", updatedAt: addDays(T, -21) + "T12:00:00Z", caseId: c.id, kind: "preflight", action: "pay_fee", payment: { type, amount, currency, amountPKR, refundable, payee: description }, eligibilityFingerprint: "historical", requestedBy: "us_officer", requestedByName: "Sana Riaz", officerConfirmedBy: "us_officer", officerConfirmedAt: addDays(T, -21) + "T10:00:00Z", managerConfirmedBy: "us_manager", managerConfirmedAt: addDays(T, -21) + "T12:00:00Z", status: "executed", executedAt: addDays(T, -21) + "T12:00:00Z" };
      await repo.set("approvals", ap.id, ap);
    }
    const p: Payment = { id, organizationId: DEMO_ORG, createdAt: addDays(T, -21) + "T12:00:00Z", updatedAt: now, caseId: c.id, studentId: c.studentId, type, description, amount, currency, amountPKR, refundable, status: "paid", authorizedBy: refundable ? ["us_officer"] : ["us_officer", "us_manager"], authorizedAt: addDays(T, -21) + "T12:00:00Z", approvalId, recordedBy: "us_officer" };
    await repo.set("payments", p.id, p);
  };
  await pay("pa_2_consult", C[1], "consultancy_fee", 150_000, "PKR", 150_000, true, "Consultancy service fee (refundable less admin charge)");
  await pay("pa_2_deposit", C[1], "tuition_deposit", 5000, "GBP", 1_892_500, false, "Harrowgate University tuition deposit");
  await pay("pa_4_consult", C[3], "consultancy_fee", 150_000, "PKR", 150_000, true, "Consultancy service fee");
  await pay("pa_5_consult", C[4], "consultancy_fee", 120_000, "PKR", 120_000, true, "Consultancy service fee");
  await pay("pa_5_campus", C[4], "application_fee", 39_500, "PKR", 39_500, false, "Campus France processing fee");
  await pay("pa_6_consult", C[5], "consultancy_fee", 120_000, "PKR", 120_000, true, "Consultancy service fee");

  await repo.transaction((tx) => audit(tx, { id: "system", name: "System", role: "system", organizationId: DEMO_ORG }, { action: "demo.seeded", entity: "organizations", entityId: DEMO_ORG, after: { students: S.length, cases: C.length } }));

  // ---------------- Run the real engines ----------------
  for (const s of S) await recomputeConsistency(repo, officer, s.id);
  await analyzeFromDocument(repo, officer, C[1].id, "dc_st_ayesha_bank_statement", d(5));
  await analyzeFromDocument(repo, officer2, C[3].id, "dc_st_fatima_bank_statement", d(14));
  await analyzeFromDocument(repo, officer, C[4].id, "dc_st_zainab_bank_statement", d(10));
  await analyzeFromDocument(repo, officer, C[5].id, "dc_st_omar_bank_statement", d(20));
  for (const c of C) {
    await recomputeEligibility(repo, officer, c.id);
    await syncTasks(repo, officer, c.id);
  }

  // ---------------- Real blocked attempts (recreating the incident) ----------------
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof GateError)) throw e;
    }
  };
  const yes = { reviewedWarnings: true, checkedAmount: true };
  await attempt(() => startPreflight(repo, officer, C[0].id, "pay_fee", { type: "tuition_deposit", amount: 3000, currency: "GBP", refundable: false, payee: "Northbridge University — CAS deposit" }, yes));
  await attempt(() => transitionCase(repo, officer, C[0].id, "Eligibility Passed"));
  await attempt(() => startPreflight(repo, officer, C[1].id, "file_visa", { type: "visa_fee", amount: 524, currency: "GBP", refundable: false, payee: "UKVI Student visa fee" }, yes));
  await attempt(() => startPreflight(repo, officer2, C[2].id, "pay_fee", { type: "application_fee", amount: 75, currency: "EUR", refundable: false, payee: "uni-assist handling fee" }, yes));
  await attempt(() => startPreflight(repo, officer2, C[3].id, "file_visa", { type: "visa_fee", amount: 116, currency: "EUR", refundable: false, payee: "Italian national visa (D) fee" }, yes));
  await attempt(() => startPreflight(repo, officer, C[4].id, "file_visa", { type: "visa_fee", amount: 99, currency: "EUR", refundable: false, payee: "France long-stay visa fee" }, yes));
  return { cases: C.length };
}
