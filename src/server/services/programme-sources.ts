// Programme requirements read from the university's official page.
//  1. import: staff paste the official link(s); the page is read and every value comes back with the
//     sentence that supports it. Staff confirm the form and save: nothing is stored unreviewed.
//  2. nightly re-check: the page is read again; if the university changed a requirement, the
//     difference is proposed to managers, who apply or dismiss it in one click.

import { PROGRAMME_SOURCE_FIELDS, aiSourceLabel, type CountryCode, type Confidence, type Programme, type ProgrammeFieldValues, type ProgrammeSource, type ProgrammeSourceField, type StudyLevel } from "@/domain/types";
import { checkRateLimit, getAI, type ProgrammeExtraction } from "../ai";
import { type Actor, assertCan } from "../auth/session";
import { sha256, signPayload, verifyPayload } from "../crypto";
import { type Repo, nowISO } from "../db";
import { fetchOfficialPage, focusPage, type OfficialPage } from "../web/official-page";
import { audit, type AuditActor } from "./audit";
import { NotFoundError } from "./bundle";
import { ValidationError } from "./documents";
import { notifyUsers, usersWithRoles } from "./notify";

export const MAX_SOURCE_URLS = 3;
const TOKEN_MAX_AGE_MS = 24 * 3600_000;

export interface ProgrammeDraft {
  country: CountryCode | null;
  values: ProgrammeFieldValues;
  evidence: Partial<Record<ProgrammeSourceField, string>>;
  confidence: Partial<Record<ProgrammeSourceField, Confidence>>;
  missing: ProgrammeSourceField[];
  notes: string[];
  warnings: string[];
  urls: string[];
  sourceLabel: string; // "Claude (model)" or "Mock AI"
  sourceToken: string;
}

interface SourceTokenPayload {
  org: string;
  urls: string[];
  hash: string;
  model: string;
  promptVersion: string;
  evidence: ProgrammeSource["evidence"];
  readValues: ProgrammeFieldValues;
  at: number;
}

const RANGES: Partial<Record<ProgrammeSourceField, [number, number]>> = {
  minCGPA4: [1, 4],
  minGermanGrade: [1, 4],
  ielts: [3, 9],
  pte: [10, 90],
  duolingo: [10, 160],
  tuitionPerYear: [0, 250_000],
  durationMonths: [1, 72],
};
const LEVELS: StudyLevel[] = ["foundation", "bachelor", "master", "phd"];

/** Turns raw page values into typed form values; anything implausible is dropped and reported. */
export function normaliseExtraction(ex: ProgrammeExtraction): Pick<ProgrammeDraft, "values" | "evidence" | "confidence" | "warnings"> {
  const values: ProgrammeFieldValues = {};
  const evidence: ProgrammeDraft["evidence"] = {};
  const confidence: ProgrammeDraft["confidence"] = {};
  const warnings: string[] = [];
  for (const key of PROGRAMME_SOURCE_FIELDS) {
    const f = ex.fields[key];
    if (!f) continue;
    const raw = f.value.trim();
    let v: string | number | boolean | null = null;
    if (RANGES[key]) {
      const n = Number(raw.replace(/[,\s£€$]/g, ""));
      const [lo, hi] = RANGES[key]!;
      if (Number.isFinite(n) && n >= lo && n <= hi) v = key === "durationMonths" ? Math.round(n) : n;
    } else if (key === "level") v = LEVELS.find((l) => l === raw.toLowerCase()) ?? null;
    else if (key === "currency") v = ["GBP", "EUR", "USD"].find((c) => c === raw.toUpperCase()) ?? null;
    else if (key === "moiAccepted") v = /^(true|yes)$/i.test(raw) ? true : null;
    else if (key === "intakeLabel") v = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
    else if (key === "intakeStart" || key === "intakeDeadline") v = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
    else if (key === "germanLevel") v = /^(A1|A2|B1|B2|C1|C2)$/i.test(raw) ? raw.toUpperCase() : null;
    else v = raw.slice(0, 200);
    if (v === null) {
      warnings.push(`Ignored "${raw.slice(0, 60)}" for ${key}: not a valid value. Enter it yourself.`);
      continue;
    }
    values[key] = v;
    evidence[key] = f.quote;
    confidence[key] = f.confidence;
  }
  if (values.intakeStart && !values.intakeLabel) values.intakeLabel = String(values.intakeStart).slice(0, 7);
  return { values, evidence, confidence, warnings };
}

function cleanUrls(urls: string[]): string[] {
  const out = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (!out.length) throw new ValidationError("Paste the link to the programme's official page.");
  if (out.length > MAX_SOURCE_URLS) throw new ValidationError(`At most ${MAX_SOURCE_URLS} links per programme.`);
  return out;
}

async function readPages(urls: string[]): Promise<{ pages: OfficialPage[]; hash: string }> {
  const pages: OfficialPage[] = [];
  for (const u of urls) pages.push(await fetchOfficialPage(u));
  const hash = sha256(pages.map((p) => (p.kind === "pdf" && p.bytes ? sha256(p.bytes) : p.text)).join("\n\u0000\n"));
  return { pages, hash };
}

const today = () => nowISO().slice(0, 10);

/** Reads the official page(s) and returns a draft for staff to confirm. Nothing is saved here. */
export async function importProgrammeDraft(actor: Actor, rawUrls: string[]): Promise<ProgrammeDraft> {
  assertCan(actor, "programmes.edit");
  const urls = cleanUrls(rawUrls);
  checkRateLimit(`ai:${actor.id}`);
  const { pages, hash } = await readPages(urls);
  const thin = pages.filter((p) => p.kind !== "pdf" && p.text.length < 400);
  const ex = await getAI().extractProgramme({ pages: pages.map(focusPage), today: today() });
  const n = normaliseExtraction(ex);
  const warnings = [...n.warnings];
  if (ex.injectionSuspected) warnings.unshift("NEEDS MANUAL VERIFICATION: the page contains text that looks like instructions to an AI. Check every value against the page yourself.");
  if (!ex.isProgrammePage) warnings.unshift("This does not look like a programme page. Use the link to the specific course and its entry requirements.");
  if (thin.length) warnings.push(`Very little text was found on ${thin.map((p) => new URL(p.url).hostname).join(", ")}. The site may build the page with JavaScript: add the link to its entry-requirements page or PDF instead.`);
  const payload: SourceTokenPayload = { org: actor.organizationId, urls: pages.map((p) => p.url), hash, model: ex.model, promptVersion: ex.promptVersion, evidence: n.evidence, readValues: n.values, at: Date.now() };
  return {
    country: ex.country,
    values: n.values,
    evidence: n.evidence,
    confidence: n.confidence,
    missing: PROGRAMME_SOURCE_FIELDS.filter((k) => n.values[k] === undefined && k !== "minGermanGrade" && k !== "germanLevel" && k !== "moiAccepted" && k !== "duolingo" && k !== "pte"),
    notes: ex.notes,
    warnings,
    urls: payload.urls,
    sourceLabel: ex.source === "mock" ? "Mock AI" : `${aiSourceLabel(ex.source)} (${ex.model})`,
    sourceToken: signPayload(payload),
  };
}

/** Verifies the signed draft token and turns it into the programme's source record. */
export function sourceFromToken(actor: Actor, token: string | undefined): ProgrammeSource | null {
  if (!token) return null;
  const t = verifyPayload<SourceTokenPayload>(token);
  if (!t || t.org !== actor.organizationId) throw new ValidationError("The imported page data could not be verified. Read the page again.");
  if (Date.now() - t.at > TOKEN_MAX_AGE_MS) throw new ValidationError("The page was read more than a day ago. Read it again before saving.");
  const now = nowISO();
  return { urls: t.urls, importedAt: now, importedBy: actor.name, checkedAt: now, contentHash: t.hash, model: t.model, promptVersion: t.promptVersion, evidence: t.evidence, readValues: t.readValues, status: "in_sync" };
}

export function currentValue(p: Programme, k: ProgrammeSourceField): string | number | boolean | null {
  const intake = p.intakes[0];
  switch (k) {
    case "ielts": case "pte": case "duolingo": case "moiAccepted": case "germanLevel": return p.english[k] ?? null;
    case "intakeLabel": return intake?.label ?? null;
    case "intakeStart": return intake?.startDate ?? null;
    case "intakeDeadline": return intake?.applicationDeadline ?? null;
    default: return (p[k] as string | number | undefined) ?? null;
  }
}

function applyValues(p: Programme, values: ProgrammeFieldValues): Programme {
  const next: Programme = { ...p, english: { ...p.english }, intakes: [...p.intakes] };
  for (const [k, v] of Object.entries(values) as [ProgrammeSourceField, string | number | boolean][]) {
    if (k === "ielts" || k === "pte" || k === "duolingo") next.english[k] = v as number;
    else if (k === "moiAccepted") next.english.moiAccepted = v as boolean;
    else if (k === "germanLevel") next.english.germanLevel = v as string;
    else if (k === "intakeLabel" || k === "intakeStart" || k === "intakeDeadline") continue;
    else (next as unknown as Record<string, unknown>)[k] = v;
  }
  if (values.intakeLabel || values.intakeStart || values.intakeDeadline) {
    const label = String(values.intakeLabel ?? next.intakes[0]?.label ?? "");
    const prev = next.intakes.find((i) => i.label === label) ?? next.intakes[0];
    const intake = { label, startDate: String(values.intakeStart ?? prev?.startDate ?? ""), applicationDeadline: String(values.intakeDeadline ?? prev?.applicationDeadline ?? "") };
    next.intakes = [intake, ...next.intakes.filter((i) => i.label !== label)];
  }
  return next;
}

const same = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase());

/** Re-reads one programme's official page; records proposed changes and tells managers. */
export async function recheckProgrammeSource(repo: Repo, actor: AuditActor, programmeId: string): Promise<ProgrammeSource["status"]> {
  const p = await repo.get<Programme>("programmes", programmeId);
  if (!p || p.organizationId !== actor.organizationId) throw new NotFoundError("Programme");
  if (!p.source) throw new ValidationError("This programme was not imported from an official page.");
  const src = p.source;
  const now = nowISO();
  let next: ProgrammeSource;
  let ex: ProgrammeExtraction | null = null;
  try {
    const { pages, hash } = await readPages(src.urls);
    if (hash === src.contentHash) next = { ...src, checkedAt: now, status: src.status === "unreachable" ? "in_sync" : src.status, lastError: undefined };
    else {
      ex = await getAI().extractProgramme({ pages: pages.map(focusPage), today: today(), background: actor.role === "system" });
      const n = normaliseExtraction(ex);
      const changes = (Object.entries(n.values) as [ProgrammeSourceField, string | number | boolean][])
        .filter(([k, v]) => !same(src.readValues[k], v))
        .map(([k, v]) => ({ field: k, before: currentValue(p, k), after: v, evidence: n.evidence[k] }));
      next = changes.length
        ? { ...src, checkedAt: now, contentHash: hash, model: ex.model, promptVersion: ex.promptVersion, status: "changed", changes, lastError: undefined }
        : { ...src, checkedAt: now, contentHash: hash, model: ex.model, promptVersion: ex.promptVersion, status: src.status === "changed" ? "changed" : "in_sync", lastError: undefined };
    }
  } catch (e) {
    next = { ...src, checkedAt: now, status: "unreachable", lastError: e instanceof Error ? e.message.slice(0, 300) : "Could not read the page." };
  }

  const newlyChanged = next.status === "changed" && JSON.stringify(next.changes) !== JSON.stringify(src.changes);
  const newlyUnreachable = next.status === "unreachable" && src.status !== "unreachable";
  await repo.transaction(async (tx) => {
    await tx.set<Programme>("programmes", p.id, { ...p, source: next, updatedAt: now });
    if (newlyChanged || newlyUnreachable)
      await audit(tx, actor, { action: newlyChanged ? "programme.source_changed" : "programme.source_unreachable", entity: "programmes", entityId: p.id, after: { urls: src.urls, changes: next.changes, error: next.lastError, model: ex?.model, promptVersion: ex?.promptVersion } });
    if (newlyChanged || newlyUnreachable) {
      const managers = await usersWithRoles(tx, p.organizationId, ["owner", "manager"]);
      await notifyUsers(tx, p.organizationId, managers.map((u) => u.id), newlyChanged
        ? { kind: "warning", title: `Official page changed: ${p.universityName} · ${p.name}`, body: next.changes!.map((c) => `${c.field}: ${c.before ?? "—"} → ${c.after}`).join("; "), link: "/programmes" }
        : { kind: "info", title: `Could not read the official page: ${p.universityName} · ${p.name}`, body: next.lastError ?? "", link: "/programmes" });
    }
  });
  return next.status;
}

/** Manager decision on proposed changes: apply them to the programme, or keep the current values. */
export async function resolveProgrammeChanges(repo: Repo, actor: Actor, programmeId: string, apply: boolean) {
  assertCan(actor, "programmes.edit");
  await repo.transaction(async (tx) => {
    const p = await tx.get<Programme>("programmes", programmeId);
    if (!p || p.organizationId !== actor.organizationId) throw new NotFoundError("Programme");
    const changes = p.source?.changes ?? [];
    if (!p.source || !changes.length) throw new ValidationError("There are no proposed changes for this programme.");
    const read = Object.fromEntries(changes.map((c) => [c.field, c.after])) as ProgrammeFieldValues;
    const evidence = Object.fromEntries(changes.filter((c) => c.evidence).map((c) => [c.field, c.evidence]));
    const base = apply ? applyValues(p, read) : p;
    const next: Programme = {
      ...base,
      updatedAt: nowISO(),
      sampleData: apply ? false : p.sampleData,
      source: { ...p.source, readValues: { ...p.source.readValues, ...read }, evidence: { ...p.source.evidence, ...evidence }, status: "in_sync", changes: undefined },
    };
    await tx.set("programmes", p.id, next);
    await audit(tx, actor, { action: apply ? "programme.source_changes_applied" : "programme.source_changes_dismissed", entity: "programmes", entityId: p.id, before: Object.fromEntries(changes.map((c) => [c.field, c.before])), after: read });
  });
}

/** Nightly: re-read pages not checked in the last 20 hours, oldest first, within the time budget. */
export async function recheckDueProgrammes(repo: Repo, budgetMs: number): Promise<{ checked: number; changed: number; unreachable: number }> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  const due = (await repo.list<Programme>("programmes")).filter((p) => p.active && p.source && p.source.checkedAt < cutoff).sort((a, b) => a.source!.checkedAt.localeCompare(b.source!.checkedAt));
  const r = { checked: 0, changed: 0, unreachable: 0 };
  for (const p of due) {
    if (Date.now() - started > budgetMs) break;
    const sys = { id: "system" as const, name: "System" as const, role: "system" as const, organizationId: p.organizationId };
    try {
      const status = await recheckProgrammeSource(repo, sys, p.id);
      r.checked++;
      if (status === "changed") r.changed++;
      if (status === "unreachable") r.unreachable++;
    } catch (e) {
      console.error("programme re-check failed for", p.id, e);
    }
  }
  return r;
}
