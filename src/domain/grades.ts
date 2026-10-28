// Grade normalisation. Pakistani results come as percentages (marks) or CGPA on a 4.0 (sometimes 5.0) scale.
// Conversions are APPROXIMATE and reported with confidence; universities apply their own tables.

import type { Confidence, EducationRecord, StudyLevel } from "./types";

export interface NormalisedGrade {
  cgpa4?: number;
  percentage?: number;
  germanGrade?: number; // modified Bavarian formula, 1.0 best .. 4.0 pass
  confidence: Confidence;
  note: string;
}

/** Approximate percentage -> 4.0 mapping commonly used by Pakistani universities (HEC-style bands). */
const PCT_BANDS: [number, number][] = [
  [85, 4.0],
  [80, 3.7],
  [75, 3.3],
  [70, 3.0],
  [65, 2.7],
  [61, 2.3],
  [58, 2.0],
  [55, 1.7],
  [50, 1.0],
];

export function percentageToCgpa4(pct: number): number {
  for (const [min, g] of PCT_BANDS) if (pct >= min) return g;
  return 0;
}

/** Modified Bavarian formula: N = 1 + 3 × (Nmax − Nd) / (Nmax − Nmin). */
export function bavarian(obtained: number, max: number, minPass: number): number {
  const n = 1 + (3 * (max - obtained)) / (max - minPass);
  return Math.round(Math.min(4, Math.max(1, n)) * 10) / 10;
}

export function normalise(r: EducationRecord): NormalisedGrade {
  if (r.obtained == null || !r.total) return { confidence: "low", note: "Grade not recorded — insufficient data." };
  if (r.gradeType === "cgpa") {
    const cgpa4 = Math.round((r.obtained / r.total) * 4 * 100) / 100;
    const minPass = r.total === 4 ? 2.0 : (r.total * 2) / 4;
    return {
      cgpa4,
      percentage: undefined,
      germanGrade: bavarian(r.obtained, r.total, minPass),
      confidence: r.total === 4 ? "high" : "medium",
      note: r.total === 4 ? `CGPA ${r.obtained}/4.00` : `CGPA ${r.obtained}/${r.total} scaled to ${cgpa4}/4.00 (approximate)`,
    };
  }
  if (r.gradeType === "percentage") {
    const pct = Math.round((r.obtained / r.total) * 1000) / 10;
    return {
      percentage: pct,
      cgpa4: percentageToCgpa4(pct),
      germanGrade: bavarian(pct, 100, 33),
      confidence: "medium",
      note: `${r.obtained}/${r.total} = ${pct}% → approx. ${percentageToCgpa4(pct)}/4.00 (band conversion; university tables may differ)`,
    };
  }
  return { confidence: "low", note: "Letter/division grade — needs manual conversion (insufficient data)." };
}

/** The qualification that admission is based on for the intended level. */
export function qualifyingRecord(education: EducationRecord[], level: StudyLevel): EducationRecord | undefined {
  const order = level === "phd" ? ["master", "bachelor"] : level === "master" ? ["bachelor"] : ["a_level", "intermediate"];
  for (const lv of order) {
    const r = education.find((e) => e.level === lv);
    if (r) return r;
  }
  return undefined;
}
