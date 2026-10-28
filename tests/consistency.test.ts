import { describe, expect, it } from "vitest";
import { compareNames, crossDocumentConsistency, documentChecks, normaliseDate, type DocFields } from "@/domain/consistency";
import type { Student } from "@/domain/types";
import { emptyStudent } from "@/server/services/students";

function student(): Student {
  const s = emptyStudent("org_t", "Muhammad Ali Raza");
  s.personal = { ...s.personal, dob: "1999-12-20", passportNumber: "FM2345678", cnic: "37405-2345678-3", fatherName: "Raza Hussain" };
  s.education = [{ id: "e1", level: "bachelor", institution: "Federal Institute of Engineering & Technology", gradeType: "cgpa", obtained: 3.1, total: 4, completed: true }];
  s.sponsors = [{ id: "s1", name: "Raza Hussain", relation: "Father" }];
  return s;
}

const doc = (id: string, docType: DocFields["docType"], fields: DocFields["fields"], extra: Partial<DocFields> = {}): DocFields => ({ documentId: id, docType, label: docType, fields, ...extra });

describe("name comparison", () => {
  it("treats transliteration variants and word order as the same name", () => {
    expect(compareNames("Muhammad Ali Raza", "MOHAMMAD ALI RAZA")).toBe("exact");
    expect(compareNames("Raza, Muhammad Ali", "Muhammad Ali Raza")).toBe("exact");
  });
  it("flags small spelling differences as variants", () => {
    expect(compareNames("Fatima Zahra", "Fatima Zehra")).toBe("variant");
  });
  it("flags different people as a mismatch", () => {
    expect(compareNames("Muhammad Ali Raza", "Ayesha Noor")).toBe("mismatch");
  });
});

describe("cross-document consistency", () => {
  it("finds no issues on a consistent file", () => {
    const flags = crossDocumentConsistency(student(), [
      doc("p", "passport", { fullName: "MUHAMMAD ALI RAZA", dob: "20/12/1999", passportNumber: "FM 2345678" }),
      doc("t", "transcript", { fullName: "Muhammad Ali Raza", institution: "Federal Institute of Engineering and Technology", cgpa: 3.1 }),
      doc("b", "bank_statement", { accountHolder: "Raza Hussain" }),
    ]);
    expect(flags).toEqual([]);
  });

  it("detects name, DOB, passport number, grade and account-holder problems, never accusing", () => {
    const flags = crossDocumentConsistency(student(), [
      doc("p", "passport", { fullName: "Muhammad Ali Raza", dob: "1999-12-20", passportNumber: "FM2345678" }),
      doc("m", "matric", { fullName: "Mohd Aly Raza" }),
      doc("i", "intermediate", { fullName: "Sana Riaz", dob: "2000-01-01" }),
      doc("e", "english_test", { fullName: "Muhammad Ali Raza", passportNumber: "FM2345679" }),
      doc("t", "transcript", { fullName: "Muhammad Ali Raza", cgpa: 3.4 }),
      doc("b", "bank_statement", { accountHolder: "Unknown Trader" }),
    ]);
    const codes = flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["NAME_VARIANT", "NAME_MISMATCH", "DOB_MISMATCH", "PASSPORT_NO_MISMATCH", "GRADE_MISMATCH", "ACCOUNT_HOLDER_UNKNOWN"]));
    for (const f of flags.filter((x) => x.severity !== "info")) expect(f.message).toMatch(/NEEDS MANUAL VERIFICATION/);
    for (const f of flags) expect(f.message).not.toMatch(/fake|fraud|forg/i);
  });

  it("checks CAS against the case and SOP against the university", () => {
    const flags = crossDocumentConsistency(
      student(),
      [doc("c", "cas", { fullName: "Muhammad Ali Raza", course: "MSc Marketing", tuitionFee: 18000, startDate: "2027-01-25" }), doc("s", "sop", { universityMentioned: "University of Eastmoor" })],
      { universityName: "Northbridge University", programmeName: "MSc Data Science", tuitionFee: 19500, intakeStartDate: "2027-01-25" },
    );
    expect(flags.map((f) => f.code)).toEqual(expect.arrayContaining(["CAS_COURSE_MISMATCH", "CAS_FEE_MISMATCH", "SOP_WRONG_UNIVERSITY"]));
  });

  it("normalises Pakistani DD/MM/YYYY dates", () => {
    expect(normaliseDate("05/03/2001")).toBe("2001-03-05");
    expect(normaliseDate("2001-03-05T00:00:00Z")).toBe("2001-03-05");
  });
});

describe("single-document completeness", () => {
  it("detects expiry, missing pages, illegibility, wrong type and instruction-like text", () => {
    const r = documentChecks(doc("x", "bank_statement", { totalPagesStated: 6 }, { pagesDetected: 4, legible: false, detectedDocType: "cv", expiryDate: "2026-01-01", injectionSuspected: true }), { today: "2026-10-28" });
    expect(r.allPages).toBe(false);
    expect(r.legible).toBe(false);
    expect(r.correctType).toBe(false);
    expect(r.notExpired).toBe(false);
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["MISSING_PAGES", "ILLEGIBLE", "WRONG_TYPE", "EXPIRED", "INSTRUCTION_TEXT"]));
  });
  it("warns when the passport expires during the course", () => {
    const r = documentChecks(doc("p", "passport", {}, { expiryDate: "2027-06-01" }), { today: "2026-10-28", courseEndDate: "2028-09-30" });
    expect(r.flags.map((f) => f.code)).toContain("PASSPORT_EXPIRES_DURING_COURSE");
  });
});
