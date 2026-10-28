// Date helpers operating on ISO calendar dates (YYYY-MM-DD) in UTC to avoid DST/timezone drift.

const DAY = 86_400_000;

export function toDateOnly(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  return date.toISOString().slice(0, 10);
}

function ms(d: string): number {
  return Date.parse(toDateOnly(d) + "T00:00:00Z");
}

export function addDays(d: string, n: number): string {
  return new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / DAY);
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isBefore(a: string, b: string): boolean {
  return ms(a) < ms(b);
}

export function maxDate(...ds: (string | undefined)[]): string | undefined {
  const v = ds.filter(Boolean) as string[];
  return v.length ? v.reduce((m, d) => (ms(d) > ms(m) ? d : m)) : undefined;
}

export function formatDate(d?: string): string {
  if (!d) return "—";
  const date = new Date(toDateOnly(d) + "T00:00:00Z");
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Each calendar date from start to end inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = toDateOnly(start); !isBefore(end, d); d = addDays(d, 1)) out.push(d);
  return out;
}

export function yearsBetween(a: string, b: string): number {
  return daysBetween(a, b) / 365.25;
}
