// University suggestions: ranked by the course the student wants, CGPA, English and budget, and kept
// current automatically when a verified transcript / English result fills the profile.
import { beforeEach, describe, expect, it } from "vitest";
import { matchProgrammes } from "@/domain/matching";
import type { DocumentRecord, ExtractedFields, MatchResult, Programme, Rule, Student } from "@/domain/types";
import type { Actor } from "@/server/auth/session";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { seedDemo } from "@/server/seed/seed";
import { fillProfileFromDocument } from "@/server/services/documents";
import { refreshMatching } from "@/server/services/programmes";

const officer: Actor = { id: "us_officer", name: "Sana Riaz", email: "o@x", role: "officer", organizationId: "org_demo" };
const TODAY = "2026-11-04";

let repo: MemoryRepo;
let student: Student;
let programmes: Programme[];
let rules: Rule[];
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepo(repo);
  await seedDemo(repo);
  const org: [string, "==", string] = ["organizationId", "==", "org_demo"];
  programmes = await repo.list<Programme>("programmes", [org]);
  rules = await repo.list<Rule>("rules", [org]);
  const base = (await repo.list<Student>("students", [org]))[0];
  // A BSCS graduate with CGPA 3.2, IELTS 6.5, PKR 1.2 crore, who wants Data Science in the UK.
  student = {
    ...base,
    education: [{ id: "ed1", level: "bachelor", institution: "FAST Lahore", program: "BS Computer Science", field: "Computer Science", gradeType: "cgpa", obtained: 3.2, total: 4, completed: true, endDate: "2025-06-30" }],
    englishTests: [{ id: "t1", type: "IELTS", overall: 6.5, testDate: "2026-08-01" }],
    budget: { totalPKR: 12_000_000 },
    intended: { level: "master", field: "Data Science", countries: ["UK"] },
    refusals: [],
    gaps: [],
  };
  await repo.set("students", student.id, student);
}, 60_000);

describe("suggested universities", () => {
  it("puts the course the student wants first and says why", () => {
    const m = matchProgrammes(student, programmes, rules, TODAY);
    const top = m.options[0];
    expect(top.programmeName).toMatch(/Data Science/);
    expect(top.why).toContain("Matches the course the student wants (Data Science)");
    const mba = m.options.find((o) => /MBA/.test(o.programmeName));
    expect(mba && mba.fitScore < top.fitScore).toBe(true);
    expect(mba?.why.some((w) => w.startsWith("Not the course the student wants"))).toBe(true);
  });

  it("explains budget either way", () => {
    const m = matchProgrammes(student, programmes, rules, TODAY);
    expect(m.options.some((o) => o.why.some((w) => w.startsWith("Within budget")))).toBe(true);
    const poor = matchProgrammes({ ...student, budget: { totalPKR: 1_000_000 } }, programmes, rules, TODAY);
    expect(poor.options.every((o) => o.why.some((w) => w.includes("exceeds budget")))).toBe(true);
  });

  it("a verified transcript fills a missing CGPA and refreshes the suggestions", async () => {
    await repo.set("students", student.id, { ...student, education: [] });
    const doc = { id: "doc_t", organizationId: "org_demo", studentId: student.id, docType: "transcript" } as DocumentRecord;
    await repo.set<ExtractedFields>("extractedFields", "ef_doc_t", { id: "ef_doc_t", organizationId: "org_demo", createdAt: TODAY, updatedAt: TODAY, documentId: "doc_t", studentId: student.id, docType: "transcript", fields: { cgpa: "3.4", scale: "4", institution: "FAST Lahore", program: "BS Computer Science" }, fieldConfidence: {}, source: "gemini" });
    expect(await fillProfileFromDocument(repo, officer, doc)).toEqual(["bachelor CGPA 3.4/4"]);
    const s = (await repo.get<Student>("students", student.id))!;
    expect(s.education[0]).toMatchObject({ level: "bachelor", gradeType: "cgpa", obtained: 3.4, total: 4, program: "BS Computer Science" });
    await refreshMatching(repo, officer, student.id, "transcript verified");
    const m = await repo.get<MatchResult>("matchResults", `mr_${student.id}`);
    expect(m?.options[0].why.some((w) => w.includes("CGPA 3.40"))).toBe(true);
  });

  it("never overwrites what staff typed, and adds a missing English result", async () => {
    const doc = { id: "doc_e", organizationId: "org_demo", studentId: student.id, docType: "english_test" } as DocumentRecord;
    await repo.set<ExtractedFields>("extractedFields", "ef_doc_e", { id: "ef_doc_e", organizationId: "org_demo", createdAt: TODAY, updatedAt: TODAY, documentId: "doc_e", studentId: student.id, docType: "english_test", fields: { testType: "PTE Academic", overall: "65", listening: "60" }, fieldConfidence: {}, source: "gemini" });
    const tdoc = { ...doc, id: "doc_t2", docType: "transcript" } as DocumentRecord;
    await repo.set<ExtractedFields>("extractedFields", "ef_doc_t2", { id: "ef_doc_t2", organizationId: "org_demo", createdAt: TODAY, updatedAt: TODAY, documentId: "doc_t2", studentId: student.id, docType: "transcript", fields: { cgpa: "2.1", scale: "4" }, fieldConfidence: {}, source: "gemini" });
    expect(await fillProfileFromDocument(repo, officer, tdoc)).toEqual([]); // CGPA 3.2 already typed
    expect(await fillProfileFromDocument(repo, officer, doc)).toEqual(["PTE 65"]);
    const s = (await repo.get<Student>("students", student.id))!;
    expect(s.education[0].obtained).toBe(3.2);
    expect(s.englishTests.map((t) => `${t.type} ${t.overall}`)).toEqual(["IELTS 6.5", "PTE 65"]);
  });
});
