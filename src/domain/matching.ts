// Country + programme matching. Bands, never promises.

import { COUNTRIES } from "./countries";
import { daysBetween, formatDate, todayISO } from "./dates";
import { fieldsAligned } from "./eligibility";
import { computeFundsRequirement, convert, formatMoney } from "./funds";
import { normalise, qualifyingRecord } from "./grades";
import { RuleContext } from "./rules";
import type { Band, CountryCode, MatchOption, Programme, Rule, Student } from "./types";

export interface MatchComputation {
  options: MatchOption[];
  strongMatch: boolean;
  honestSummary: string;
  alternatives: string[];
}

export function matchProgrammes(student: Student, programmes: Programme[], rules: Rule[], today: string = todayISO()): MatchComputation {
  const level = student.intended.level ?? "master";
  const countries: CountryCode[] = student.intended.countries.length ? student.intended.countries : (Object.keys(COUNTRIES) as CountryCode[]);
  const rec = qualifyingRecord(student.education, level);
  const grade = rec ? normalise(rec) : undefined;
  const options: MatchOption[] = [];
  const failureTally = { academic: 0, language: 0, budget: 0, intake: 0 };

  for (const p of programmes.filter((x) => x.active && x.level === level && countries.includes(x.country))) {
    const why: string[] = [];
    const missing: string[] = [];
    let fit = 100;
    let acceptance: Band = "Good";

    // academic
    if (!grade || grade.cgpa4 == null) {
      fit -= 15;
      acceptance = "Moderate";
      missing.push("Qualifying grade (insufficient data)");
    } else if (p.country === "DE" && p.minGermanGrade != null && grade.germanGrade != null) {
      const margin = p.minGermanGrade - grade.germanGrade;
      if (margin < 0) {
        fit -= 40;
        acceptance = "Low";
        failureTally.academic++;
        why.push(`German grade ${grade.germanGrade} weaker than minimum ${p.minGermanGrade}`);
      } else if (margin < 0.3) {
        fit -= 10;
        acceptance = "Moderate";
        why.push(`Grade ${grade.germanGrade} close to minimum ${p.minGermanGrade}`);
      } else why.push(`Grade ${grade.germanGrade} comfortably meets ${p.minGermanGrade}`);
    } else if (p.minCGPA4 != null) {
      const margin = grade.cgpa4 - p.minCGPA4;
      if (margin < 0) {
        fit -= 40;
        acceptance = "Low";
        failureTally.academic++;
        why.push(`CGPA ${grade.cgpa4.toFixed(2)} below minimum ${p.minCGPA4.toFixed(2)}`);
      } else if (margin < 0.2) {
        fit -= 10;
        acceptance = "Moderate";
        why.push(`CGPA ${grade.cgpa4.toFixed(2)} just above minimum ${p.minCGPA4.toFixed(2)}`);
      } else why.push(`CGPA ${grade.cgpa4.toFixed(2)} meets minimum ${p.minCGPA4.toFixed(2)}`);
    } else {
      fit -= 5;
      missing.push("Programme minimum not recorded");
    }

    // field alignment
    const aligned = fieldsAligned(rec?.field ?? rec?.program, `${p.field} ${p.keywords.join(" ")}`);
    if (aligned === false) {
      fit -= 10;
      why.push("Field differs from previous study — SOP must justify");
    }

    // language
    const tests = student.englishTests;
    const meets = tests.some(
      (t) =>
        (t.type === "IELTS" && p.english.ielts != null && (t.overall ?? 0) >= p.english.ielts) ||
        (t.type === "PTE" && p.english.pte != null && (t.overall ?? 0) >= p.english.pte) ||
        (t.type === "Duolingo" && p.english.duolingo != null && (t.overall ?? 0) >= p.english.duolingo) ||
        (t.type === "MOI" && p.english.moiAccepted),
    );
    if (!tests.length) {
      fit -= 10;
      missing.push("English test");
    } else if (!meets) {
      fit -= 25;
      if (acceptance === "Good") acceptance = "Moderate";
      failureTally.language++;
      why.push(`English below requirement (IELTS ${p.english.ielts ?? "—"}${p.english.moiAccepted ? ", MOI accepted" : ""})`);
    } else why.push("English requirement met");

    // cost
    const ctx = new RuleContext(rules, { country: p.country, level: p.level, intake: p.intakes[0]?.label }, today);
    const req = computeFundsRequirement({ country: p.country, courseMonths: p.durationMonths, tuitionFee: { amount: p.tuitionPerYear * Math.max(1, p.durationMonths / 12), currency: p.currency }, tuitionPaid: 0, inLondon: p.inLondon, level: p.level }, ctx);
    const includesTuition = p.country === "UK" || p.country === "FR";
    const total = req.total + (includesTuition ? 0 : p.tuitionPerYear);
    const pkr = convert(total, req.currency, "PKR", ctx);
    if (student.budget.totalPKR && pkr && pkr.amount > student.budget.totalPKR) {
      const over = (pkr.amount - student.budget.totalPKR) / student.budget.totalPKR;
      fit -= Math.min(25, Math.round(over * 50));
      failureTally.budget++;
      why.push(`Estimated first-year cost ${formatMoney(Math.round(pkr.amount), "PKR")} exceeds budget`);
    }

    // intake
    const intake = p.intakes.filter((i) => daysBetween(today, i.applicationDeadline) >= 0).sort((a, b) => a.applicationDeadline.localeCompare(b.applicationDeadline))[0];
    let intakeStatus: MatchOption["intakeStatus"] = "none";
    if (!intake) {
      fit -= 30;
      intakeStatus = p.intakes.length ? "closed" : "none";
      failureTally.intake++;
      why.push("No open intake");
    } else {
      const left = daysBetween(today, intake.applicationDeadline);
      intakeStatus = left <= 30 ? "closing_soon" : "open";
      if (left <= 30) fit -= 5;
      why.push(`Next intake ${intake.label} — apply by ${formatDate(intake.applicationDeadline)} (${left} days)`);
    }
    if (p.country === "DE") missing.push("APS certificate (if not held)");
    if (p.country === "IT") missing.push("Universitaly pre-enrolment, DoV/CIMEA");
    if (p.country === "FR") missing.push("Campus France EEF + interview");

    // visa risk band
    let risk = 0;
    risk += student.refusals.length * 2;
    if (p.complianceNotes?.toLowerCase().includes("pakistan")) risk += 1;
    if (student.gaps.length > 0) risk += 1;
    if (aligned === false) risk += 1;
    const visaRiskBand: MatchOption["visaRiskBand"] = risk >= 3 ? "High" : risk >= 1 ? "Medium" : "Low";
    if (visaRiskBand === "High") fit -= 15;
    else if (visaRiskBand === "Medium") fit -= 5;
    if (p.complianceNotes) why.push(p.complianceNotes);

    options.push({
      programmeId: p.id,
      programmeName: p.name,
      universityName: p.universityName,
      country: p.country,
      fitScore: Math.max(0, Math.min(100, fit)),
      estimatedTotalCost: { amount: Math.round(total), currency: req.currency, amountPKR: Math.round(pkr?.amount ?? 0) },
      acceptanceBand: acceptance,
      visaRiskBand,
      intake,
      intakeStatus,
      missing,
      why,
    });
  }

  options.sort((a, b) => b.fitScore - a.fitScore);
  const top = options[0];
  const strongMatch = !!top && top.fitScore >= 70 && top.acceptanceBand !== "Low";
  const alternatives: string[] = [];
  if (!strongMatch) {
    if (failureTally.academic) alternatives.push("Consider a foundation / pre-master pathway, or programmes with a lower minimum CGPA.");
    if (failureTally.language) alternatives.push("Retake IELTS/PTE to reach the required score before applying.");
    if (failureTally.budget) alternatives.push("Wait to build funds, consider lower-tuition countries (Germany/Italy public universities), or apply for scholarships.");
    if (failureTally.intake) alternatives.push("Target the next intake/academic year.");
    if (!alternatives.length) alternatives.push("Widen countries of interest or fields in the profile.");
  }
  const honestSummary = !options.length
    ? "No programmes in the database match this student's level and countries. Add programmes or broaden the search."
    : strongMatch
      ? `${options.filter((o) => o.fitScore >= 70).length} programme(s) look like a reasonable fit. Bands are estimates, not promises; verify each requirement with the university.`
      : "No strong match right now. Applying to the options below carries a real risk of losing non-refundable fees.";
  return { options, strongMatch, honestSummary, alternatives };
}
