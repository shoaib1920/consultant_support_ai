// Profile completeness meter: weighted checklist with a human-readable "missing" list.

import type { Student } from "./types";

interface Item {
  label: string;
  weight: number;
  ok: (s: Student) => boolean;
}

const ITEMS: Item[] = [
  { label: "Full name (as on passport)", weight: 5, ok: (s) => !!s.personal.fullName },
  { label: "Date of birth", weight: 5, ok: (s) => !!s.personal.dob },
  { label: "Passport number & expiry", weight: 8, ok: (s) => !!s.personal.passportNumber && !!s.personal.passportExpiry },
  { label: "CNIC", weight: 4, ok: (s) => !!s.personal.cnic },
  { label: "Father's name", weight: 3, ok: (s) => !!s.personal.fatherName },
  { label: "Contact (phone & email)", weight: 4, ok: (s) => !!s.personal.phone && !!s.personal.email },
  { label: "Matric / O-Level result", weight: 6, ok: (s) => s.education.some((e) => (e.level === "matric" || e.level === "o_level") && e.obtained != null) },
  { label: "Intermediate / A-Level result", weight: 8, ok: (s) => s.education.some((e) => (e.level === "intermediate" || e.level === "a_level") && e.obtained != null) },
  {
    label: "Bachelor result (CGPA + scale) for postgraduate study",
    weight: 10,
    ok: (s) => s.intended.level !== "master" && s.intended.level !== "phd" ? true : s.education.some((e) => e.level === "bachelor" && e.obtained != null && !!e.total),
  },
  { label: "Education dates (start/end)", weight: 4, ok: (s) => s.education.length > 0 && s.education.every((e) => !!e.endDate) },
  { label: "Study gaps explained", weight: 5, ok: (s) => s.gaps.every((g) => g.reason.trim().length >= 10) },
  { label: "English test or MOI", weight: 8, ok: (s) => s.englishTests.length > 0 },
  { label: "Sponsor details", weight: 6, ok: (s) => s.sponsors.length > 0 && s.sponsors.every((sp) => !!sp.relation) },
  { label: "Budget", weight: 4, ok: (s) => !!s.budget.totalPKR },
  { label: "Intended level, field and intake", weight: 8, ok: (s) => !!s.intended.level && !!s.intended.field && !!s.intended.intake },
  { label: "Countries of interest", weight: 4, ok: (s) => s.intended.countries.length > 0 },
  { label: "Visa refusal & travel history answered", weight: 4, ok: (s) => Array.isArray(s.refusals) && Array.isArray(s.travel) },
  { label: "Data-processing consent", weight: 4, ok: (s) => s.consent.given },
];

export function profileCompleteness(s: Student): { percent: number; missing: string[] } {
  const total = ITEMS.reduce((a, i) => a + i.weight, 0);
  let got = 0;
  const missing: string[] = [];
  for (const i of ITEMS) {
    if (i.ok(s)) got += i.weight;
    else missing.push(i.label);
  }
  return { percent: Math.round((got / total) * 100), missing };
}

export const PROFILE_COMPLETE_THRESHOLD = 90;
