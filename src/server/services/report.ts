// One-screen Refusal Risk Report data + PDF export (pdf-lib, standard fonts).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COUNTRIES, requiredDocsFor } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { topRisks } from "@/domain/eligibility";
import { riskClearance } from "@/domain/gates";
import { computeDeadlines } from "@/domain/tasks";
import type { Deadline, Light, Reason } from "@/domain/types";
import { type CaseBundle, gateContext } from "./bundle";

export interface ReportData {
  title: string;
  generatedAt: string;
  light?: Light;
  score?: number;
  lightReason?: string;
  top: Reason[];
  fixes: string[];
  ask: string[];
  checklist: { label: string; status: "done" | "pending" | "missing" | "flagged" }[];
  deadlines: Deadline[];
  gate: { cleared: boolean; blockers: string[] };
  ruleIssues: string[];
  aiSummary?: string;
  aiSource?: string;
}

export function buildReport(b: CaseBundle): ReportData {
  const e = b.eligibility;
  const top = e ? topRisks(e.reasons, 5) : [];
  const fixes = [...new Set((e?.reasons ?? []).filter((r) => r.severity !== "info" && r.fix).map((r) => r.fix!))].slice(0, 8);
  const ask = [...new Set((e?.reasons ?? []).filter((r) => r.askStudent).map((r) => r.askStudent!))].slice(0, 8);
  const checklist: ReportData["checklist"] = requiredDocsFor(b.kase.country, b.kase.level).map((req) => {
    const docs = b.documents.filter((d) => d.docType === req.docType && d.reviewStatus !== "rejected");
    const status = !docs.length ? "missing" : docs.some((d) => d.flags.some((f) => !f.resolved && f.severity === "critical")) ? "flagged" : docs.some((d) => d.reviewStatus === "verified") ? "done" : "pending";
    return { label: req.label + (req.optional ? " (optional)" : ""), status };
  });
  for (const chk of COUNTRIES[b.kase.country].checks) {
    const st = b.kase.countryChecks[chk.key]?.status;
    checklist.push({ label: chk.label, status: st === "complete" || st === "not_required" ? "done" : st === "in_progress" ? "pending" : "missing" });
  }
  return {
    title: `${b.kase.studentName} — ${b.kase.universityName}, ${b.kase.programmeName} (${COUNTRIES[b.kase.country].name}, ${b.kase.intake})`,
    generatedAt: new Date().toISOString(),
    light: e?.light,
    score: e?.score,
    lightReason: e?.lightReason,
    top,
    fixes,
    ask,
    checklist,
    deadlines: computeDeadlines(b.kase, b.student, b.financial, b.attestations, b.rules).filter((d) => d.daysLeft >= -30).slice(0, 8),
    gate: riskClearance(gateContext(b)),
    ruleIssues: (e?.ruleIssues ?? []).map((i) => `${i.key}: ${i.problem}`),
    aiSummary: e?.ai?.summary,
    aiSource: e?.ai ? `${e.ai.source === "mock" ? "Mock AI" : "Claude"} (${e.ai.model}, ${e.ai.promptVersion})` : undefined,
  };
}

const LIGHT_COLOR: Record<Light, [number, number, number]> = { GREEN: [0.09, 0.5, 0.27], AMBER: [0.75, 0.5, 0.05], RED: [0.75, 0.12, 0.12] };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/[^\x20-\x7E£€]/g, (c) => (c === "—" || c === "–" ? "-" : c === "→" ? "->" : c === "×" ? "x" : c === "“" || c === "”" ? '"' : c === "’" ? "'" : "")).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t.replace(/[£€]/g, "E"), size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function reportPdf(r: ReportData, orgName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 800;
  const M = 48;
  const W = 595 - 2 * M;
  const ensure = (h: number) => {
    if (y - h < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
  };
  // pdf-lib standard fonts are WinAnsi: replace £/€ which may not render in all viewers
  const clean = (s: string) => s.replace(/£/g, "GBP ").replace(/€/g, "EUR ");
  const text = (s: string, opts: { size?: number; f?: PDFFont; color?: [number, number, number]; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    for (const line of wrap(clean(s), opts.f ?? font, size, W - (opts.indent ?? 0))) {
      ensure(size + 4);
      page.drawText(line, { x: M + (opts.indent ?? 0), y, size, font: opts.f ?? font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])) });
      y -= size + 4;
    }
  };
  const heading = (s: string) => {
    y -= 8;
    text(s, { size: 12, f: bold });
    y -= 2;
  };

  text(`${orgName} - Refusal Risk Report`, { size: 9, color: [0.4, 0.4, 0.45] });
  text(r.title, { size: 14, f: bold });
  text(`Generated ${formatDate(r.generatedAt)} - VisaGuard decision-support output`, { size: 9, color: [0.4, 0.4, 0.45] });
  y -= 6;
  if (r.light) {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 26, width: W, height: 32, color: rgb(...LIGHT_COLOR[r.light]) });
    page.drawText(clean(`${r.light}  -  score ${r.score}/100  -  ${r.lightReason ?? ""}`).slice(0, 95), { x: M + 10, y: y - 14, size: 12, font: bold, color: rgb(1, 1, 1) });
    y -= 42;
  } else text("No assessment yet.", { f: bold });
  text(r.gate.cleared ? "Gates: clear for the next irreversible step (still requires pre-flight double confirmation)." : "Gates: BLOCKED for payment/submission.", { f: bold });
  for (const b of r.gate.blockers.slice(0, 6)) text(`- ${b}`, { indent: 10, size: 9 });
  if (r.ruleIssues.length) {
    heading("Rules needing verification");
    for (const x of r.ruleIssues) text(`- ${x}`, { indent: 10 });
  }
  heading("Top risks");
  if (!r.top.length) text("No open risks.");
  r.top.forEach((x, i) => {
    text(`${i + 1}. [${x.hardFail ? "BLOCKING" : x.severity.toUpperCase()}] ${x.title}`, { f: bold });
    text(x.detail, { indent: 12, size: 9 });
    text(`Source: ${x.refs.map((f) => f.label).join("; ")} - confidence ${x.confidence}`, { indent: 12, size: 8, color: [0.4, 0.4, 0.45] });
  });
  heading("What to fix");
  for (const f of r.fixes) text(`- ${f}`, { indent: 10 });
  heading("What to ask the student");
  for (const a of r.ask) text(`- ${a}`, { indent: 10 });
  heading("Checklist");
  for (const c of r.checklist) text(`[${c.status === "done" ? "x" : c.status === "flagged" ? "!" : " "}] ${c.label} - ${c.status}`, { indent: 10, size: 9 });
  heading("Deadlines");
  for (const d of r.deadlines) text(`- ${d.label}: ${formatDate(d.date)} (${d.daysLeft} days)`, { indent: 10, size: 9 });
  if (r.aiSummary) {
    heading("AI explanation");
    text(r.aiSummary, { size: 9 });
    text(`Generated by ${r.aiSource}. AI explains; staff decide.`, { size: 8, color: [0.4, 0.4, 0.45] });
  }
  y -= 10;
  text("DISCLAIMER: VisaGuard is a decision-support tool, not legal or immigration advice. Outputs depend on rules verified by staff and on the accuracy of documents provided. It does not guarantee admission or visa approval.", { size: 8, color: [0.35, 0.35, 0.4] });
  return pdf.save();
}
