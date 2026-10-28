import { matchProgrammes } from "@/domain/matching";
import type { MatchResult, Programme, Rule, Student, University } from "@/domain/types";
import { type Actor, assertCan } from "../auth/session";
import { type Repo, newId, nowISO } from "../db";
import type { z } from "zod";
import type { ProgrammeSchema } from "../schemas";
import { audit } from "./audit";
import { NotFoundError } from "./bundle";

export async function upsertProgramme(repo: Repo, actor: Actor, programmeId: string | null, input: z.infer<typeof ProgrammeSchema>) {
  assertCan(actor, "programmes.edit");
  await repo.transaction(async (tx) => {
    const unis = await tx.list<University>("universities", [["organizationId", "==", actor.organizationId]]);
    const now = nowISO();
    let uni = unis.find((u) => u.name.toLowerCase() === input.universityName.toLowerCase() && u.country === input.country);
    if (!uni) {
      uni = { id: newId("un_"), organizationId: actor.organizationId, createdAt: now, updatedAt: now, name: input.universityName, country: input.country, city: input.city, inLondon: input.inLondon, complianceNotes: input.complianceNotes, sampleData: false };
      await tx.set("universities", uni.id, uni);
    }
    const prev = programmeId ? await tx.get<Programme>("programmes", programmeId) : null;
    if (programmeId && (!prev || prev.organizationId !== actor.organizationId)) throw new NotFoundError("Programme");
    const p: Programme = {
      id: prev?.id ?? newId("pg_"),
      organizationId: actor.organizationId,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      universityId: uni.id,
      universityName: uni.name,
      country: input.country,
      city: input.city,
      inLondon: input.inLondon,
      name: input.name,
      level: input.level,
      field: input.field,
      keywords: input.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
      minCGPA4: input.minCGPA4,
      minGermanGrade: input.minGermanGrade,
      english: { ielts: input.ielts, pte: input.pte, duolingo: input.duolingo, moiAccepted: input.moiAccepted, germanLevel: input.germanLevel },
      tuitionPerYear: input.tuitionPerYear,
      currency: input.currency,
      durationMonths: input.durationMonths,
      intakes: [
        { label: input.intakeLabel, startDate: input.intakeStart, applicationDeadline: input.intakeDeadline },
        ...(prev?.intakes.filter((i) => i.label !== input.intakeLabel) ?? []),
      ],
      complianceNotes: input.complianceNotes,
      sampleData: false, // edited or user-created entries are no longer sample data
      active: input.active,
    };
    await tx.set("programmes", p.id, p);
    await audit(tx, actor, { action: prev ? "programme.updated" : "programme.created", entity: "programmes", entityId: p.id, before: prev ?? undefined, after: p });
  });
}

export async function runMatching(repo: Repo, actor: Actor, studentId: string): Promise<MatchResult> {
  assertCan(actor, "analysis.run");
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [student, programmes, rules] = await Promise.all([repo.get<Student>("students", studentId), repo.list<Programme>("programmes", [org]), repo.list<Rule>("rules", [org])]);
  if (!student || student.organizationId !== actor.organizationId) throw new NotFoundError("Student");
  const m = matchProgrammes(student, programmes, rules);
  const now = nowISO();
  const res: MatchResult = { id: `mr_${studentId}`, organizationId: actor.organizationId, createdAt: now, updatedAt: now, studentId, ...m };
  await repo.transaction(async (tx) => {
    await tx.set("matchResults", res.id, res);
    await audit(tx, actor, { action: "matching.run", entity: "matchResults", entityId: res.id, after: { options: m.options.length, strongMatch: m.strongMatch } });
  });
  return res;
}
