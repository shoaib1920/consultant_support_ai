// Free trial for self-service sign-ups. Pure logic: no framework, no datastore.

import type { Organization } from "./types";

export const TRIAL_DAYS = 14;

export function trialEndsAt(from: Date = new Date()): string {
  return new Date(from.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
}

export interface TrialInfo {
  onTrial: boolean;
  expired: boolean;
  /** Whole days left, rounded up (the last day shows 1, not 0). */
  daysLeft: number;
}

export function trialInfo(org: Pick<Organization, "plan" | "trialEndsAt"> | null | undefined, now: Date = new Date()): TrialInfo {
  if (!org || org.plan !== "trial") return { onTrial: false, expired: false, daysLeft: 0 };
  // a trial with no end date is treated as ended rather than unlimited
  const end = org.trialEndsAt ? Date.parse(org.trialEndsAt) : NaN;
  const ms = Number.isNaN(end) ? 0 : end - now.getTime();
  return { onTrial: true, expired: ms <= 0, daysLeft: Math.max(0, Math.ceil(ms / 86_400_000)) };
}

export const TRIAL_ENDED_MESSAGE = `Your consultancy's ${TRIAL_DAYS}-day free trial has ended. Your data is kept safe: contact us to upgrade and continue.`;
