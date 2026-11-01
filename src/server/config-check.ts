// Deployment self-check: which settings are present, by NAME only (values are never exposed).

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() === "true";
}

/** Settings a live (non-demo) deployment needs, with a plain-language problem for each missing one. */
export function configProblems(): string[] {
  const p: string[] = [];
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!sa) p.push("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  else {
    try {
      const j = JSON.parse(sa);
      if (!j.private_key || !j.client_email) p.push("FIREBASE_SERVICE_ACCOUNT_JSON is missing private_key or client_email");
    } catch {
      p.push("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file as one line)");
    }
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) p.push("NEXT_PUBLIC_FIREBASE_API_KEY is not set (needed for the email login box)");
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) p.push("SESSION_SECRET is not set (or shorter than 16 characters)");
  if (!process.env.STORAGE_ENCRYPTION_KEY) p.push("STORAGE_ENCRYPTION_KEY is not set");
  return p;
}
