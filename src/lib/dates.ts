/** Date helpers. Postgres `date` columns are read/written as UTC midnight, so everything here works in UTC. */

const DAY_MS = 86_400_000;

/** Strip the time part: a Date at 00:00:00 UTC on the same calendar day (UTC). */
export function dateOnly(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY_MS);
}

/** YYYY-MM-DD */
export function isoDate(d: Date): string {
  return dateOnly(d).toISOString().slice(0, 10);
}

/** First day of the month `offset` months from `d` (offset -1 = last month). */
export function firstOfMonth(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
