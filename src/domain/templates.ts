// Copy-ready WhatsApp / email templates. Nothing is auto-sent; staff copy and send manually.
// Student-facing text never includes internal scores, lights or notes.

import { COUNTRIES, isDueNow, requiredDocsFor } from "./countries";
import { formatDate } from "./dates";
import type { Case, Deadline, DocumentRecord, Student } from "./types";

export interface MessageTemplate {
  key: string;
  label: string;
  channel: "whatsapp" | "email";
  subject?: string;
  body: string;
}

export function missingDocsFor(kase: Case, documents: DocumentRecord[]): string[] {
  return requiredDocsFor(kase.country, kase.level)
    .filter((r) => !r.optional && isDueNow(r.neededBefore, kase.stage) && !documents.some((d) => d.docType === r.docType && d.reviewStatus !== "rejected"))
    .map((r) => r.label);
}

export function buildTemplates(student: Student, kase: Case, documents: DocumentRecord[], deadlines: Deadline[], orgName: string): MessageTemplate[] {
  const first = student.personal.fullName.split(" ")[0];
  const missing = missingDocsFor(kase, documents);
  const reupload = documents.filter((d) => d.reviewStatus === "rejected" || d.flags.some((f) => !f.resolved && (f.code === "ILLEGIBLE" || f.code === "MISSING_PAGES")));
  const soon = deadlines.filter((d) => d.daysLeft >= 0 && d.daysLeft <= 30);
  const country = COUNTRIES[kase.country].name;
  const out: MessageTemplate[] = [];

  if (missing.length) {
    const list = missing.map((m, i) => `${i + 1}. ${m}`).join("\n");
    out.push({ key: "missing-wa", label: "Missing documents", channel: "whatsapp", body: `Assalam-o-Alaikum ${first},\n\nTo continue your ${country} application (${kase.universityName}) we still need:\n${list}\n\nPlease upload them in your VisaGuard student portal or send clear scans of ALL pages.\n\nThank you,\n${orgName}` });
    out.push({ key: "missing-email", label: "Missing documents", channel: "email", subject: `Documents needed for your ${country} application`, body: `Dear ${student.personal.fullName},\n\nThank you for choosing ${orgName}. To move your application for ${kase.programmeName} at ${kase.universityName} forward, we need the following documents:\n\n${list}\n\nPlease upload complete, clear copies (all pages) through your student portal. We will not make any payment or submission on your behalf until your documents have been checked.\n\nKind regards,\n${orgName}` });
  }
  if (reupload.length) {
    out.push({ key: "reupload-wa", label: "Re-upload request", channel: "whatsapp", body: `Hi ${first}, some documents need a clearer or complete copy:\n${reupload.map((d) => `• ${d.fileName}`).join("\n")}\nPlease upload again in the portal. Thank you — ${orgName}` });
  }
  if (soon.length) {
    out.push({ key: "deadline-wa", label: "Upcoming deadlines", channel: "whatsapp", body: `Hi ${first}, reminder of upcoming dates for your ${country} application:\n${soon.map((d) => `• ${d.label}: ${formatDate(d.date)} (${d.daysLeft} days)`).join("\n")}\nPlease contact us if anything is pending. — ${orgName}` });
  }
  out.push({ key: "status-wa", label: "Status update", channel: "whatsapp", body: `Hi ${first}, your ${country} application for ${kase.programmeName} is currently at: "${kase.stage}". We will message you when there is something you need to do. — ${orgName}` });
  return out;
}
