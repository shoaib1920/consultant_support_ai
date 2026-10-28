// Zod validation for every input that crosses the client/server boundary.

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optDate = isoDate.optional().or(z.literal("").transform(() => undefined));
const optStr = (max = 200) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const optNum = z.coerce.number().finite().optional().or(z.literal("").transform(() => undefined));
const id = z.string().min(1).max(64);

export const CountrySchema = z.enum(["UK", "DE", "IT", "FR"]);
export const LevelSchema = z.enum(["foundation", "bachelor", "master", "phd"]);
export const CurrencySchema = z.enum(["PKR", "GBP", "EUR", "USD"]);
export const DocTypeSchema = z.enum([
  "passport", "cnic", "photo", "matric", "intermediate", "degree", "transcript", "english_test", "bank_statement", "sponsor_letter", "sponsor_income",
  "police_certificate", "sop", "cv", "medical_tb", "aps_certificate", "cas", "offer_letter", "dov_cimea", "health_insurance", "accommodation", "blocked_account", "other",
]);

export const StudentProfileSchema = z.object({
  personal: z.object({
    fullName: z.string().trim().min(2, "Full name is required").max(120),
    givenNames: optStr(80),
    surname: optStr(80),
    fatherName: optStr(120),
    dob: optDate,
    gender: z.enum(["male", "female", "other"]).optional().or(z.literal("").transform(() => undefined)),
    cnic: z.string().trim().regex(/^(\d{5}-?\d{7}-?\d)?$/, "CNIC format: 12345-1234567-1").optional(),
    passportNumber: z.string().trim().toUpperCase().regex(/^([A-Z0-9]{6,12})?$/, "Passport number: 6-12 letters/digits").optional(),
    passportExpiry: optDate,
    nationality: z.string().trim().min(2).max(60).default("Pakistani"),
    city: optStr(80),
    phone: optStr(30),
    email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
    address: optStr(300),
    maritalStatus: z.enum(["single", "married", "other"]).optional().or(z.literal("").transform(() => undefined)),
  }),
  education: z
    .array(
      z.object({
        id,
        level: z.enum(["matric", "o_level", "intermediate", "a_level", "bachelor", "master"]),
        institution: z.string().trim().min(2).max(200),
        board: optStr(200),
        program: optStr(200),
        field: optStr(120),
        startDate: optDate,
        endDate: optDate,
        gradeType: z.enum(["percentage", "cgpa", "grade"]),
        obtained: optNum,
        total: optNum,
        backlogs: optNum,
        completed: z.coerce.boolean().default(true),
      }).refine((e) => e.gradeType !== "cgpa" || e.obtained == null || (e.total != null && e.obtained <= e.total), { message: "CGPA cannot exceed its scale", path: ["obtained"] })
        .refine((e) => e.gradeType !== "percentage" || e.obtained == null || (e.total != null && e.obtained <= e.total), { message: "Marks obtained cannot exceed total", path: ["obtained"] }),
    )
    .max(10),
  gaps: z.array(z.object({ id, from: isoDate, to: isoDate, reason: z.string().trim().max(1000), evidence: optStr(300) })).max(10),
  englishTests: z
    .array(z.object({ id, type: z.enum(["IELTS", "PTE", "Duolingo", "TOEFL", "MOI"]), overall: optNum, listening: optNum, reading: optNum, writing: optNum, speaking: optNum, testDate: optDate, expiryDate: optDate }))
    .max(6),
  work: z.array(z.object({ id, employer: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(120), from: isoDate, to: optDate, description: optStr(500) })).max(10),
  sponsors: z.array(z.object({ id, name: z.string().trim().min(2).max(120), relation: z.string().trim().min(2).max(60), occupation: optStr(120), annualIncomePKR: optNum, phone: optStr(30) })).max(5),
  budget: z.object({ totalPKR: optNum, notes: optStr(500) }),
  intended: z.object({ level: LevelSchema.optional(), field: optStr(120), intake: z.string().regex(/^(\d{4}-\d{2})?$/).optional(), countries: z.array(CountrySchema).max(4) }),
  refusals: z.array(z.object({ id, country: z.string().trim().min(2).max(60), year: z.coerce.number().int().min(1990).max(2100), visaType: optStr(60), reason: optStr(500) })).max(10),
  travel: z.array(z.object({ id, country: z.string().trim().min(2).max(60), year: z.coerce.number().int().min(1990).max(2100), purpose: optStr(120) })).max(20),
  tiesToPakistan: optStr(1000),
  consentGiven: z.coerce.boolean(),
  internalNotes: optStr(4000),
});
export type StudentProfileInput = z.infer<typeof StudentProfileSchema>;

export const CaseCreateSchema = z.object({
  studentId: id,
  programmeId: id.optional(),
  country: CountrySchema,
  universityName: z.string().trim().min(2).max(200),
  programmeName: z.string().trim().min(2).max(200),
  programmeField: optStr(120),
  level: LevelSchema,
  intake: z.string().regex(/^\d{4}-\d{2}$/, "Intake as YYYY-MM"),
  intakeStartDate: isoDate,
  applicationDeadline: optDate,
  plannedVisaApplicationDate: optDate,
  city: optStr(80),
  inLondon: z.coerce.boolean().default(false),
  courseMonths: z.coerce.number().int().min(1).max(72),
  tuitionAmount: z.coerce.number().min(0).max(10_000_000),
  tuitionCurrency: CurrencySchema,
  tuitionPaid: z.coerce.number().min(0).default(0),
  minCGPA4: optNum,
  minGermanGrade: optNum,
  ielts: optNum,
  pte: optNum,
  duolingo: optNum,
  moiAccepted: z.coerce.boolean().default(false),
  assignedOfficerId: optStr(64),
});

export const CaseUpdateSchema = CaseCreateSchema.omit({ studentId: true, programmeId: true, country: true }).partial();

export const CountryCheckSchema = z.object({
  key: z.string().min(1).max(64),
  status: z.enum(["complete", "in_progress", "not_started", "not_required"]),
  date: optDate,
  reference: optStr(120),
  note: optStr(500),
});

export const RuleUpdateSchema = z.object({
  value: z.union([z.number(), z.string().max(1000), z.boolean()]),
  unit: z.string().max(40),
  label: z.string().min(2).max(200),
  sourceUrl: z.string().url().max(500),
  sourceNote: optStr(500),
  status: z.enum(["Verified", "Unverified", "Conflicting"]),
  notes: optStr(1000),
  reason: z.string().trim().min(5, "Explain the change").max(500),
});

export const RuleCreateSchema = z.object({
  country: z.enum(["UK", "DE", "IT", "FR", "*"]),
  level: z.enum(["foundation", "bachelor", "master", "phd", "*"]),
  intake: z.string().max(10),
  key: z.string().regex(/^[a-z0-9_.A-Z]+$/).max(80),
  label: z.string().min(2).max(200),
  value: z.union([z.number(), z.string().max(1000), z.boolean()]),
  unit: z.string().max(40),
  sourceUrl: z.string().url().max(500),
  notes: optStr(1000),
});

export const ProgrammeSchema = z.object({
  universityName: z.string().trim().min(2).max(200),
  country: CountrySchema,
  city: z.string().trim().min(2).max(80),
  inLondon: z.coerce.boolean().default(false),
  name: z.string().trim().min(2).max(200),
  level: LevelSchema,
  field: z.string().trim().min(2).max(120),
  keywords: z.string().max(300).default(""),
  minCGPA4: optNum,
  minGermanGrade: optNum,
  ielts: optNum,
  pte: optNum,
  duolingo: optNum,
  moiAccepted: z.coerce.boolean().default(false),
  germanLevel: optStr(20),
  tuitionPerYear: z.coerce.number().min(0),
  currency: CurrencySchema,
  durationMonths: z.coerce.number().int().min(1).max(72),
  intakeLabel: z.string().regex(/^\d{4}-\d{2}$/),
  intakeStart: isoDate,
  intakeDeadline: isoDate,
  complianceNotes: optStr(500),
  active: z.coerce.boolean().default(true),
});

export const PaymentSchema = z.object({
  type: z.enum(["consultancy_fee", "application_fee", "tuition_deposit", "visa_fee", "ihs", "insurance", "blocked_account", "attestation_fee", "courier", "other"]),
  amount: z.coerce.number().positive().max(100_000_000),
  currency: CurrencySchema,
  refundable: z.boolean(), // strict: the string "false" must not become true
  payee: optStr(200),
});

export const StatementSchema = z.object({
  currency: CurrencySchema,
  accountHolder: optStr(120),
  bankName: optStr(120),
  openingBalance: z.coerce.number(),
  statementStart: isoDate,
  statementEnd: isoDate,
  transactions: z.array(z.object({ date: isoDate, description: z.string().max(200), amount: z.coerce.number(), balance: z.coerce.number() })).max(2000),
  applicationDate: isoDate,
  explanations: z.array(z.object({ date: isoDate, amount: z.coerce.number(), note: z.string().min(3).max(300) })).max(50).default([]),
});

export const AttestationStepSchema = z.object({
  attestationId: id,
  authority: z.enum(["BOARD", "IBCC", "HEC", "MOFA", "EMBASSY", "APS", "DOV", "CIMEA", "TRANSLATION"]),
  status: z.enum(["not_started", "submitted", "in_progress", "completed", "rejected", "not_required"]),
  submittedAt: optDate,
  completedAt: optDate,
  reference: optStr(120),
});

export const UserCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  role: z.enum(["owner", "manager", "officer", "counsellor"]),
});
