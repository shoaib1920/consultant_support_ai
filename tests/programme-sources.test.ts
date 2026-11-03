// Importing programme requirements from the university's official page, and the nightly re-check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification, Programme } from "@/domain/types";
import { setAI, type AIProvider } from "@/server/ai";
import { MockProvider } from "@/server/ai/mock";
import type { Actor } from "@/server/auth/session";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { ProgrammeSchema } from "@/server/schemas";
import { seedDemo } from "@/server/seed/seed";
import { importProgrammeDraft, normaliseExtraction, recheckProgrammeSource, resolveProgrammeChanges } from "@/server/services/programme-sources";
import { upsertProgramme } from "@/server/services/programmes";
import { assertPublicUrl, htmlToText } from "@/server/web/official-page";

const manager: Actor = { id: "us_manager", name: "Bilal Ahmed", email: "m@x", role: "manager", organizationId: "org_demo" };
const officer: Actor = { id: "us_officer", name: "Sana Riaz", email: "o@x", role: "officer", organizationId: "org_demo" };
const URL_ = "http://93.184.216.34/courses/msc-data-science"; // public IP literal: no DNS needed in tests

const page = (ielts: string) => `<!doctype html><html><head><title>MSc Data Science | Northbridge University</title>
<script>window.track = "ignore me";</script><style>.x{}</style></head><body>
<nav>Home Courses Contact</nav>
<h1>MSc Data Science</h1>
<p>Duration: 1 year full-time. Course starts 21 September 2027.</p>
<h2>Entry requirements</h2>
<p>Pakistan: a CGPA of 3.0/4.0 in a relevant bachelor&rsquo;s degree.</p>
<p>English: IELTS Academic ${ielts} overall with no band below 6.0, or PTE Academic 62.</p>
<h2>Fees</h2>
<table><tr><td>International students</td><td>&pound;18,500 per year</td></tr></table>
<p>Application deadline for international students: 30 June 2027.</p>
<footer>© Northbridge</footer></body></html>`;

let html = page("6.5");
const fetchMock = vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));

let repo: MemoryRepo;
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepo(repo);
  await seedDemo(repo);
  setAI(new MockProvider());
  html = page("6.5");
  vi.stubGlobal("fetch", fetchMock);
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
  setAI(undefined as unknown as AIProvider);
});

const formFrom = (v: Record<string, unknown>) =>
  ProgrammeSchema.parse({ universityName: v.universityName, country: "UK", city: "Northbridge", name: v.name, level: v.level, field: "Data Science", keywords: "data", minCGPA4: v.minCGPA4, ielts: v.ielts, pte: v.pte, tuitionPerYear: v.tuitionPerYear, currency: v.currency, durationMonths: v.durationMonths, intakeLabel: v.intakeLabel, intakeStart: v.intakeStart, intakeDeadline: v.intakeDeadline });

describe("reading official pages", () => {
  it("turns HTML into readable text without scripts, styles or navigation", () => {
    const { text, title } = htmlToText(page("6.5"));
    expect(title).toBe("MSc Data Science | Northbridge University");
    expect(text).toContain("£18,500 per year");
    expect(text).toContain("bachelor’s degree");
    expect(text).not.toMatch(/ignore me|\.x\{|Home Courses|© Northbridge/);
  });

  it("refuses internal and non-web addresses", async () => {
    for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "file:///etc/passwd", "https://user:pw@93.184.216.34/", "http://93.184.216.34:8080/"])
      await expect(assertPublicUrl(u), u).rejects.toThrow();
    await expect(assertPublicUrl(URL_)).resolves.toBeInstanceOf(URL);
  });

  it("drops implausible values instead of saving them", () => {
    const n = normaliseExtraction({ isProgrammePage: true, injectionSuspected: false, country: "UK", notes: [], source: "mock", model: "m", promptVersion: "p", fields: { ielts: { value: "65", quote: "IELTS 65", confidence: "high" }, pte: { value: "62", quote: "PTE 62", confidence: "high" }, intakeDeadline: { value: "30/06/2027", quote: "x", confidence: "low" } } });
    expect(n.values).toEqual({ pte: 62 });
    expect(n.warnings).toHaveLength(2);
  });
});

describe("import and nightly re-check", () => {
  it("fills the programme from the page with a quote for every value", async () => {
    const d = await importProgrammeDraft(manager, [URL_]);
    expect(d.values).toMatchObject({ universityName: "Northbridge University", name: "MSc Data Science", level: "master", minCGPA4: 3, ielts: 6.5, pte: 62, tuitionPerYear: 18500, currency: "GBP", durationMonths: 12, intakeLabel: "2027-09", intakeStart: "2027-09-21", intakeDeadline: "2027-06-30" });
    expect(d.evidence.ielts).toMatch(/IELTS Academic 6\.5/);
    expect(d.country).toBe("UK");
  });

  it("only staff who may edit programmes can import", async () => {
    await expect(importProgrammeDraft(officer, [URL_])).rejects.toThrow(/not allowed/);
  });

  it("rejects a forged or foreign import token", async () => {
    const d = await importProgrammeDraft(manager, [URL_]);
    const input = formFrom(d.values);
    await expect(upsertProgramme(repo, manager, null, input, d.sourceToken.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).rejects.toThrow(/could not be verified/);
    await expect(upsertProgramme(repo, { ...manager, organizationId: "org_other" }, null, input, d.sourceToken)).rejects.toThrow(/could not be verified/);
  });

  it("flags a change on the official page for a manager to apply", async () => {
    const d = await importProgrammeDraft(manager, [URL_]);
    await upsertProgramme(repo, manager, null, formFrom(d.values), d.sourceToken);
    const saved = (await repo.list<Programme>("programmes", [["organizationId", "==", "org_demo"]])).find((p) => p.source)!;
    expect(saved.source).toMatchObject({ status: "in_sync", urls: [URL_], importedBy: "Bilal Ahmed" });

    // same page: nothing to report
    expect(await recheckProgrammeSource(repo, manager, saved.id)).toBe("in_sync");

    // the university raises the IELTS requirement
    html = page("7.0");
    expect(await recheckProgrammeSource(repo, manager, saved.id)).toBe("changed");
    let p = (await repo.get<Programme>("programmes", saved.id))!;
    expect(p.source!.changes).toEqual([expect.objectContaining({ field: "ielts", before: 6.5, after: 7 })]);
    expect(p.english.ielts).toBe(6.5); // never applied silently
    const notes = await repo.list<Notification>("notifications", [["organizationId", "==", "org_demo"]]);
    expect(notes.some((n) => n.title.startsWith("Official page changed"))).toBe(true);

    await resolveProgrammeChanges(repo, manager, saved.id, true);
    p = (await repo.get<Programme>("programmes", saved.id))!;
    expect(p.english.ielts).toBe(7);
    expect(p.source).toMatchObject({ status: "in_sync", readValues: expect.objectContaining({ ielts: 7 }) });
    expect(p.source!.changes).toBeUndefined();
  });

  it("dismissing keeps current values and does not flag the same change again", async () => {
    const d = await importProgrammeDraft(manager, [URL_]);
    await upsertProgramme(repo, manager, null, formFrom(d.values), d.sourceToken);
    const id = (await repo.list<Programme>("programmes", [["organizationId", "==", "org_demo"]])).find((p) => p.source)!.id;
    html = page("7.0");
    await recheckProgrammeSource(repo, manager, id);
    await resolveProgrammeChanges(repo, manager, id, false);
    html = page("7.0") + " "; // page re-rendered, same requirements
    expect(await recheckProgrammeSource(repo, manager, id)).toBe("in_sync");
    expect((await repo.get<Programme>("programmes", id))!.english.ielts).toBe(6.5);
  });

  it("marks the source unreachable when the page is gone", async () => {
    const d = await importProgrammeDraft(manager, [URL_]);
    await upsertProgramme(repo, manager, null, formFrom(d.values), d.sourceToken);
    const id = (await repo.list<Programme>("programmes", [["organizationId", "==", "org_demo"]])).find((p) => p.source)!.id;
    fetchMock.mockImplementationOnce(async () => new Response("gone", { status: 404 }));
    expect(await recheckProgrammeSource(repo, manager, id)).toBe("unreachable");
    expect((await repo.get<Programme>("programmes", id))!.source!.lastError).toMatch(/HTTP 404/);
  });
});
