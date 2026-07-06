/**
 * UTC ISO 8601 time helpers. All persisted timestamps are stored as ISO strings
 * in UTC to keep comparisons and ordering locale-independent.
 */

/** Current moment as an ISO 8601 UTC string. */
export function now(): string {
  return new Date().toISOString();
}

/** Returns a new ISO string offset from `iso` by `days` (may be negative). */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Returns a new ISO string offset from `iso` by `seconds`. */
export function addSeconds(iso: string, seconds: number): string {
  const d = new Date(iso);
  d.setUTCSeconds(d.getUTCSeconds() + seconds);
  return d.toISOString();
}

/** True when `iso` is in the past relative to now. */
export function isExpired(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}
