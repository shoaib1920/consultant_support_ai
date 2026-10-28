// SAMPLE programme database (fictional institutions, realistic shapes). Marked sampleData=true.
// Replace with real, verified programme data before production use.

import type { CountryCode, Currency, Intake, Programme, StudyLevel, University } from "@/domain/types";

interface P {
  uni: string;
  city: string;
  london?: boolean;
  name: string;
  level?: StudyLevel;
  field: string;
  kw: string;
  min?: number;
  minDe?: number;
  ielts?: number;
  pte?: number;
  moi?: boolean;
  german?: string;
  fee: number;
  months: number;
  notes?: string;
  strict?: University["pakistanStrictness"];
}

const UK_INTAKES: Intake[] = [
  { label: "2027-01", startDate: "2027-01-25", applicationDeadline: "2026-12-01" },
  { label: "2027-09", startDate: "2027-09-20", applicationDeadline: "2027-07-15" },
];
const DE_INTAKES: Intake[] = [
  { label: "2027-04", startDate: "2027-04-01", applicationDeadline: "2027-01-15" },
  { label: "2027-10", startDate: "2027-10-01", applicationDeadline: "2027-05-31" },
];
const IT_INTAKES: Intake[] = [
  { label: "2026-11", startDate: "2026-11-16", applicationDeadline: "2026-11-10" },
  { label: "2027-09", startDate: "2027-09-27", applicationDeadline: "2027-04-30" },
];
const FR_INTAKES: Intake[] = [
  { label: "2027-01", startDate: "2027-01-11", applicationDeadline: "2026-11-15" },
  { label: "2027-09", startDate: "2027-09-06", applicationDeadline: "2027-03-31" },
];

const DATA: Record<CountryCode, { currency: Currency; intakes: Intake[]; items: P[] }> = {
  UK: {
    currency: "GBP",
    intakes: UK_INTAKES,
    items: [
      { uni: "Northbridge University", city: "London", london: true, name: "MSc Data Science", field: "Data Science", kw: "data,computing,analytics,ai", min: 3.0, ielts: 6.5, pte: 64, fee: 19500, months: 12, notes: "Elevated scrutiny for Pakistan; pre-CAS interview mandatory; £3,000 deposit before CAS", strict: "high" },
      { uni: "University of Eastmoor", city: "Birmingham", name: "MSc Computer Science", field: "Computer Science", kw: "computing,software,computer", min: 2.5, ielts: 6.0, pte: 59, fee: 16200, months: 12 },
      { uni: "Kingsford Metropolitan University", city: "London", london: true, name: "MBA (Global Management)", field: "Business Administration", kw: "business,management,mba", min: 2.8, ielts: 6.5, fee: 21000, months: 12, notes: "Pakistan applicants: deposit £4,000; credibility interview", strict: "elevated" },
      { uni: "Harrowgate University", city: "Leeds", name: "MSc Public Health", field: "Public Health", kw: "health,public,epidemiology", min: 2.7, ielts: 6.5, fee: 17000, months: 12 },
      { uni: "University of West Lyndon", city: "Glasgow", name: "MSc Finance and Investment", field: "Finance", kw: "finance,accounting,economics,business", min: 3.3, ielts: 6.5, fee: 24000, months: 12 },
      { uni: "Caledon University", city: "Manchester", name: "MSc Engineering Management", field: "Engineering Management", kw: "engineering,management,mechanical,industrial", min: 2.5, ielts: 6.0, moi: true, fee: 15500, months: 12 },
      { uni: "Caledon University", city: "Manchester", name: "International Pre-Master's (Business & Engineering)", level: "master", field: "Pathway", kw: "pathway,business,engineering,computing,pre-master", min: 2.0, ielts: 5.5, moi: true, fee: 9800, months: 6, notes: "Pathway programme — progression to MSc subject to grades" },
    ],
  },
  DE: {
    currency: "EUR",
    intakes: DE_INTAKES,
    items: [
      { uni: "TU Rheinfeld", city: "Rheinfeld", name: "MSc Computer Science", field: "Computer Science", kw: "computing,software,computer,ai", minDe: 2.5, ielts: 6.5, fee: 700, months: 24, notes: "Semester contribution only; uni-assist VPD required" },
      { uni: "Hochschule Elbtal", city: "Dresden", name: "MEng Mechatronics", field: "Mechatronics", kw: "engineering,mechatronics,mechanical,electrical,automation", minDe: 2.7, ielts: 6.0, fee: 1500, months: 18 },
      { uni: "University of Weserburg", city: "Bremen", name: "MSc Data Analytics", field: "Data Analytics", kw: "data,analytics,computing,statistics", minDe: 2.3, ielts: 6.5, fee: 700, months: 24 },
      { uni: "Technische Hochschule Isarstadt", city: "Munich", name: "MEng Industrial Automation", field: "Automation", kw: "engineering,automation,industrial,electrical", minDe: 2.8, ielts: 6.0, fee: 3000, months: 18 },
      { uni: "Freistadt University", city: "Frankfurt", name: "MA International Management", field: "International Management", kw: "business,management,economics", minDe: 2.5, ielts: 6.5, german: "A2", fee: 0, months: 24 },
      { uni: "Ostsee University", city: "Kiel", name: "MSc Renewable Energy Systems", field: "Renewable Energy", kw: "engineering,energy,electrical,mechanical", minDe: 2.7, ielts: 6.5, fee: 700, months: 24 },
    ],
  },
  IT: {
    currency: "EUR",
    intakes: IT_INTAKES,
    items: [
      { uni: "University of Valcorso", city: "Milan", name: "MSc Computer Engineering", field: "Computer Engineering", kw: "computing,computer,engineering,software", min: 2.8, ielts: 6.0, moi: true, fee: 3900, months: 24, notes: "Requires CIMEA statement (not DoV)" },
      { uni: "Politecnico di Marenna", city: "Turin", name: "MSc Mechanical Engineering", field: "Mechanical Engineering", kw: "engineering,mechanical", min: 3.0, ielts: 6.0, fee: 3800, months: 24 },
      { uni: "University of Saltera", city: "Bologna", name: "MSc Economics and Finance", field: "Economics", kw: "economics,finance,business", min: 2.7, ielts: 6.0, moi: true, fee: 2500, months: 24 },
      { uni: "University of Lunigiana", city: "Pisa", name: "MSc Data Science", field: "Data Science", kw: "data,computing,statistics,ai", min: 2.6, ielts: 6.0, fee: 2000, months: 24 },
      { uni: "Ateneo di Pievarno", city: "Padua", name: "MSc Biotechnology", field: "Biotechnology", kw: "biology,biotechnology,health", min: 2.8, ielts: 6.0, fee: 1800, months: 24 },
      { uni: "University of Castellaro", city: "Rome", name: "MBA", field: "Business Administration", kw: "business,management,mba", min: 2.5, ielts: 6.0, moi: true, fee: 4500, months: 12 },
    ],
  },
  FR: {
    currency: "EUR",
    intakes: FR_INTAKES,
    items: [
      { uni: "Université de Montclar", city: "Lyon", name: "Master in Computer Science (English-taught)", field: "Computer Science", kw: "computing,software,computer,ai,informatique", min: 2.8, ielts: 6.5, fee: 3879, months: 24 },
      { uni: "École Supérieure de Gestion Vauban", city: "Lille", name: "MSc International Business", field: "International Business", kw: "business,management,marketing", min: 2.7, ielts: 6.0, fee: 14500, months: 18 },
      { uni: "Université Rives-de-Loire", city: "Nantes", name: "Master in Data Science", field: "Data Science", kw: "data,computing,statistics", min: 3.0, ielts: 6.5, fee: 3879, months: 24 },
      { uni: "Institut Polytechnique de Garonne", city: "Toulouse", name: "MSc Aerospace Engineering", field: "Aerospace Engineering", kw: "engineering,aerospace,mechanical", min: 3.0, ielts: 6.5, fee: 9800, months: 24 },
      { uni: "Université de Bellerive", city: "Bordeaux", name: "Master in Public Health", field: "Public Health", kw: "health,public", min: 2.6, ielts: 6.0, fee: 3879, months: 24 },
      { uni: "Lumière School of Management", city: "Paris", name: "MBA", field: "Business Administration", kw: "business,management,mba", min: 2.5, ielts: 6.0, fee: 16000, months: 12 },
    ],
  },
};

export function materialiseProgrammes(organizationId: string): { universities: University[]; programmes: Programme[] } {
  const now = new Date().toISOString();
  const universities: University[] = [];
  const programmes: Programme[] = [];
  for (const [country, d] of Object.entries(DATA) as [CountryCode, (typeof DATA)[CountryCode]][]) {
    d.items.forEach((p, i) => {
      const uniId = `un_${country}_${p.uni.toLowerCase().replace(/[^a-z]+/g, "_")}`.slice(0, 48);
      if (!universities.some((u) => u.id === uniId)) {
        universities.push({ id: uniId, organizationId, createdAt: now, updatedAt: now, name: p.uni, country, city: p.city, inLondon: p.london, complianceNotes: p.notes, pakistanStrictness: p.strict ?? "normal", sampleData: true });
      }
      programmes.push({
        id: `pg_${country}_${i + 1}`,
        organizationId,
        createdAt: now,
        updatedAt: now,
        universityId: uniId,
        universityName: p.uni,
        country,
        city: p.city,
        inLondon: p.london,
        name: p.name,
        level: p.level ?? "master",
        field: p.field,
        keywords: p.kw.split(","),
        minCGPA4: p.min,
        minGermanGrade: p.minDe,
        english: { ielts: p.ielts, pte: p.pte, moiAccepted: p.moi, germanLevel: p.german },
        tuitionPerYear: p.fee,
        currency: d.currency,
        durationMonths: p.months,
        intakes: d.intakes,
        complianceNotes: p.notes,
        sampleData: true,
        active: true,
      });
    });
  }
  return { universities, programmes };
}
