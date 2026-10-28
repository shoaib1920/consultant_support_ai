// Seed rules. ALL values are marked "Seed - verify against official source".
// In demo mode they are pre-verified by the demo manager so the all-GREEN case can exist,
// except deliberate exceptions: France funds (Conflicting), Italy repatriation (Unverified placeholder),
// Germany blocked-account monthly (verified 75 days ago -> STALE).

import { addDays, todayISO } from "@/domain/dates";
import type { Rule, RuleStatus, RuleValue } from "@/domain/types";

type SeedRule = Omit<Rule, "id" | "organizationId" | "createdAt" | "updatedAt" | "lastVerifiedAt" | "verifiedBy" | "status" | "seed"> & { status?: RuleStatus; verifiedDaysAgo?: number };

const SEED_NOTE = "Seed - verify against official source";
const r = (country: Rule["country"], key: string, label: string, value: RuleValue, unit: string, sourceUrl: string, extra: Partial<SeedRule> = {}): SeedRule => ({
  country,
  level: "*",
  intake: "*",
  key,
  label,
  value,
  unit,
  sourceUrl,
  sourceNote: SEED_NOTE,
  ...extra,
});

const UKVI = "https://www.gov.uk/student-visa/money";
const UKVI_GUIDE = "https://www.gov.uk/government/publications/student-route-sponsor-guidance";
const DE_EMB = "https://pakistan.diplo.de/pk-en/service/visa-einreise/studentvisa";
const APS = "https://pakistan.diplo.de/pk-en/service/aps";
const IT_VISTO = "https://vistoperitalia.esteri.it/home/en";
const IT_UNI = "https://www.universitaly.it/";
const FR_CF = "https://www.pakistan.campusfrance.org/";
const FR_VISA = "https://france-visas.gouv.fr/";
const POLICY = "https://internal.policy/visaguard";

export const SEED_RULES: SeedRule[] = [
  // ---------- UK (Student Route) ----------
  r("UK", "funds.maintenance_monthly_london", "Maintenance per month — London", 1529, "GBP/month", UKVI, { intake: "2026-27" }),
  r("UK", "funds.maintenance_monthly_outside_london", "Maintenance per month — outside London", 1171, "GBP/month", UKVI, { intake: "2026-27" }),
  r("UK", "funds.max_months", "Maintenance months tested (max)", 9, "months", UKVI),
  r("UK", "funds.holding_days", "Funds held for consecutive days", 28, "days", UKVI),
  r("UK", "funds.statement_max_age_days", "28-day period must end within N days of application", 31, "days", UKVI),
  r("UK", "funds.lowest_balance_tested", "Lowest balance in the window is tested", true, "", UKVI),
  r("UK", "cas.must_match", "CAS details must match the application exactly", "Name, course, fees, dates on CAS must match the visa application and supporting documents.", "", UKVI_GUIDE),
  r("UK", "statement.format", "Bank statement format", "Statement must show account holder name, account number, bank name/logo, date and balance; printed online statements need bank stamp or letter.", "", UKVI),
  r("UK", "statement.permitted_institutions", "Permitted financial institutions", "Funds must be held with an institution UKVI accepts for Pakistan (check the excluded list).", "", "https://www.gov.uk/government/publications/financial-institutions-for-tuberculosis-and-student-visa"),
  r("UK", "deposits.source_of_funds", "Unexplained deposits / source of funds", "Large recent deposits may require evidence of source; officers can query credibility.", "", UKVI_GUIDE),
  r("UK", "english.requirement", "English requirement", "Set by the university per level (SELT or university assessment for degree level).", "", "https://www.gov.uk/student-visa/knowledge-of-english"),
  r("UK", "tb.required_pakistan", "TB test certificate required (Pakistan residents)", true, "", "https://www.gov.uk/tb-test-visa"),
  r("UK", "credibility.pre_cas_interview", "University pre-CAS credibility interview possible", true, "", UKVI_GUIDE),
  r("UK", "compliance.pakistan_scrutiny", "Sponsor compliance pressure", "Universities facing refusal-rate (BCA) pressure may apply stricter checks, deposits or interviews for Pakistani applicants.", "", UKVI_GUIDE),

  // ---------- Germany ----------
  r("DE", "funds.blocked_account_yearly", "Blocked account (Sperrkonto) per year", 11904, "EUR/year", DE_EMB),
  r("DE", "funds.blocked_account_monthly", "Blocked account monthly release", 992, "EUR/month", DE_EMB, { verifiedDaysAgo: 75 }),
  r("DE", "funds.blocked_account_required", "Blocked account or accepted proof of funds required", true, "", DE_EMB),
  r("DE", "aps.mandatory", "APS certificate mandatory for Pakistani applicants", true, "", APS),
  r("DE", "aps.validity_years", "APS certificate validity", 5, "years", APS),
  r("DE", "attestation.chain", "Attestation chain for Pakistani documents", "Board/IBCC (school), HEC (degree), MOFA, embassy legalisation as required; APS verifies academic documents.", "", APS),
  r("DE", "admission.route", "Admission route", "uni-assist or university direct, per programme.", "", "https://www.uni-assist.de/en/"),
  r("DE", "language.proof", "Language proof", "IELTS/TOEFL for English-taught or German level (e.g. B2/C1) per programme.", "", DE_EMB),
  r("DE", "docs.required", "Other visa documents", "Motivation letter, CV, health insurance, gap explanation, embassy appointment via consular portal.", "", DE_EMB),
  r("DE", "funds.holding_days", "Statement test window (closing balance)", 1, "days", POLICY, { sourceNote: "Internal policy - blocked account confirmation is the primary evidence" }),
  r("DE", "funds.statement_max_age_days", "Statement max age at application", 30, "days", POLICY, { sourceNote: "Internal policy" }),

  // ---------- Italy ----------
  r("IT", "universitaly.mandatory", "Universitaly pre-enrolment validated by the university", true, "", IT_UNI),
  r("IT", "dov_cimea.required", "Declaration of Value or CIMEA statement (as university requires)", true, "", "https://www.cimea.it/"),
  r("IT", "funds.yearly", "Means of subsistence per academic year", 10179.85, "EUR/year", IT_VISTO),
  r("IT", "funds.repatriation", "Funds for repatriation (placeholder estimate)", 1000, "EUR", IT_VISTO, { status: "Unverified", notes: "Placeholder: official text requires funds for repatriation without a fixed figure. Verify with the embassy/VFS checklist." }),
  r("IT", "visa.application_deadline", "Visa application deadline (AY 2026-27)", "2026-11-30", "date", IT_VISTO, { intake: "2026-27" }),
  r("IT", "visa.appointments", "Appointment channel", "Prenot@mi / VFS Global Pakistan.", "", "https://visa.vfsglobal.com/pak/en/ita"),
  r("IT", "docs.legalisation", "Qualifications in original, translated into Italian and legalised", "As required by the university/embassy.", "", IT_VISTO),
  r("IT", "docs.other", "Other visa documents", "Health insurance, accommodation proof, return ticket/booking.", "", IT_VISTO),
  r("IT", "funds.lawful_traceable", "Funds must be lawful, traceable and belong to student/family", true, "", IT_VISTO),
  r("IT", "funds.holding_days", "Statement test window (closing balance)", 1, "days", POLICY, { sourceNote: "Internal policy - large deposits are flagged separately" }),
  r("IT", "funds.statement_max_age_days", "Statement max age at application", 30, "days", POLICY, { sourceNote: "Internal policy" }),

  // ---------- France ----------
  r("FR", "campusfrance.mandatory", "Campus France EEF file + interview before visa appointment", true, "", FR_CF),
  r("FR", "funds.monthly", "Living costs per month", 615, "EUR/month", FR_VISA, {
    status: "Conflicting",
    notes: "CONFLICT: one source reports a change to ~EUR 877.50/month (47% of SMIC) for applications from 1 Aug 2026. Verify on official French sources (France-Visas / Campus France) before any France case can go GREEN.",
    sourceNote: "Conflicting - verify on official French sources",
  }),
  r("FR", "funds.tuition_one_year_required", "Plus one year of tuition", true, "", FR_VISA),
  r("FR", "docs.other", "Other visa documents", "Accommodation proof, health insurance, admission letter.", "", FR_VISA),
  r("FR", "ofii.validation", "VLS-TS validation with OFII after arrival", "Validate online within 3 months of arrival.", "", "https://administration-etrangers-en-france.interieur.gouv.fr/"),
  r("FR", "funds.holding_days", "Statement test window (closing balance)", 1, "days", POLICY, { sourceNote: "Internal policy" }),
  r("FR", "funds.statement_max_age_days", "Statement max age at application", 30, "days", POLICY, { sourceNote: "Internal policy" }),

  // ---------- Global: FX, policy, attestation durations ----------
  r("*", "fx.GBP_PKR", "FX rate GBP→PKR", 378.5, "PKR per GBP", "https://www.sbp.org.pk/ecodata/rates/m2m/M2M-Current.asp", { sourceNote: "Seed - illustrative rate; update from SBP/bank before use" }),
  r("*", "fx.EUR_PKR", "FX rate EUR→PKR", 325.4, "PKR per EUR", "https://www.sbp.org.pk/ecodata/rates/m2m/M2M-Current.asp", { sourceNote: "Seed - illustrative rate; update from SBP/bank before use" }),
  r("*", "fx.USD_PKR", "FX rate USD→PKR", 281.2, "PKR per USD", "https://www.sbp.org.pk/ecodata/rates/m2m/M2M-Current.asp", { sourceNote: "Seed - illustrative rate; update from SBP/bank before use" }),
  r("*", "policy.large_deposit_ratio", "Flag credits ≥ this multiple of the prior 30-day average balance", 0.5, "ratio", POLICY, { sourceNote: "Internal risk policy" }),
  ...(
    [
      ["BOARD", 14],
      ["IBCC", 10],
      ["HEC", 21],
      ["MOFA", 7],
      ["EMBASSY", 10],
      ["APS", 75],
      ["DOV", 45],
      ["CIMEA", 30],
      ["TRANSLATION", 7],
    ] as const
  ).map(([a, d]) => r("*", `attestation.days.${a}`, `Expected processing time — ${a}`, d, "days", POLICY, { sourceNote: "Internal estimate from recent cases" })),
];

export function materialiseRules(organizationId: string, verifierName: string): Rule[] {
  const now = new Date().toISOString();
  const today = todayISO();
  return SEED_RULES.map((s, i) => {
    const { verifiedDaysAgo, status, ...rest } = s;
    const st = status ?? "Verified";
    return {
      ...rest,
      id: `ru_seed_${String(i).padStart(3, "0")}`,
      organizationId,
      createdAt: now,
      updatedAt: now,
      status: st,
      lastVerifiedAt: st === "Verified" ? addDays(today, -(verifiedDaysAgo ?? 10)) + "T09:00:00.000Z" : undefined,
      verifiedBy: st === "Verified" ? `${verifierName} (demo seed)` : undefined,
      seed: true,
    };
  });
}
