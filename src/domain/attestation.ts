// Attestation chain timing: sequential steps (e.g. HEC -> MOFA -> APS). Expected durations
// come from rules `attestation.days.<AUTHORITY>` so offices can tune them from experience.

import { addDays, daysBetween, isBefore, maxDate, todayISO } from "./dates";
import type { AttestationAuthority, AttestationStep } from "./types";

export const AUTHORITY_LABELS: Record<AttestationAuthority, string> = {
  BOARD: "Board (BISE)",
  IBCC: "IBCC",
  HEC: "HEC",
  MOFA: "MOFA",
  EMBASSY: "Embassy legalisation",
  APS: "APS (Germany)",
  DOV: "Declaration of Value (Italy)",
  CIMEA: "CIMEA statement (Italy)",
  TRANSLATION: "Sworn translation",
};

export interface ChainEta {
  eta: string;
  steps: { authority: AttestationAuthority; expectedEnd: string; status: AttestationStep["status"]; overdue: boolean }[];
  remainingDays: number;
}

export function chainEta(steps: AttestationStep[], today: string = todayISO()): ChainEta {
  let cursor = today;
  const out: ChainEta["steps"] = [];
  for (const s of steps) {
    let end: string;
    let overdue = false;
    if (s.status === "completed" || s.status === "not_required") {
      end = s.completedAt ?? cursor;
      cursor = maxDate(cursor, end)!;
    } else if ((s.status === "submitted" || s.status === "in_progress") && s.submittedAt) {
      end = addDays(s.submittedAt, s.expectedDays);
      if (isBefore(end, today)) {
        overdue = true;
        end = addDays(today, 7); // overdue: assume at least one more week
      }
      end = maxDate(end, cursor)!;
      cursor = end;
    } else {
      end = addDays(cursor, s.expectedDays);
      cursor = end;
    }
    out.push({ authority: s.authority, expectedEnd: end, status: s.status, overdue });
  }
  return { eta: cursor, steps: out, remainingDays: Math.max(0, daysBetween(today, cursor)) };
}

export function chainFinishesBefore(steps: AttestationStep[], deadline: string, today?: string): { ok: boolean; eta: string; slackDays: number } {
  const { eta } = chainEta(steps, today);
  const slackDays = daysBetween(eta, deadline);
  return { ok: slackDays >= 0, eta, slackDays };
}
