import type { AlertKind, CredentialStatus, VerificationResult } from "@prisma/client";
import { addDays, dateOnly, daysBetween } from "./dates";

export interface StatusInput {
  expiresOn: Date | null;
  renewalLeadDays: number;
  /** Result of the most recent verification, if any. */
  latestResult: VerificationResult | null;
}

/**
 * Credential status, recomputed nightly and on every save.
 *
 *   expired   if expires_on < today
 *   expiring  if expires_on <= today + renewal_lead_days
 *   suspended if the latest verification said suspended (sticky until a later one says otherwise)
 *   unknown   if it never expires and has never been verified
 *   active    otherwise
 */
export function computeStatus(input: StatusInput, today: Date = new Date()): CredentialStatus {
  const t = dateOnly(today);
  if (input.latestResult === "suspended") return "suspended";
  if (input.latestResult === "not_found") return "unknown";
  if (input.expiresOn) {
    const left = daysBetween(t, input.expiresOn);
    if (left < 0) return "expired";
    if (left <= input.renewalLeadDays) return "expiring";
    return "active";
  }
  if (input.latestResult === null) return "unknown";
  if (input.latestResult === "expired") return "unknown";
  return "active";
}

/**
 * When the next primary-source verification is due.
 * Verified before: latest verification + reverify interval.
 * Never verified:  the fallback (issued_on, hire date, or creation date) so it is due immediately.
 */
export function computeNextVerifyDue(
  latestVerifiedAt: Date | null,
  reverifyDays: number,
  fallback: Date
): Date {
  if (latestVerifiedAt) return dateOnly(addDays(latestVerifiedAt, reverifyDays));
  return dateOnly(fallback);
}

export const LEAD_ALERTS: ReadonlyArray<{ kind: AlertKind; days: number }> = [
  { kind: "lead_90", days: 90 },
  { kind: "lead_60", days: 60 },
  { kind: "lead_30", days: 30 },
  { kind: "lead_7", days: 7 },
];

/**
 * Every expiry alert that should have fired by `today` for a credential expiring on `expiresOn`.
 * The nightly job sends the ones not yet logged for the current expiry cycle; the seed uses the
 * same list to back-date history. Each entry carries the date it would have fired.
 */
export function expiryAlertsDueBy(expiresOn: Date, today: Date = new Date()): Array<{ kind: AlertKind; on: Date }> {
  const t = dateOnly(today);
  const out: Array<{ kind: AlertKind; on: Date }> = [];
  for (const lead of LEAD_ALERTS) {
    const fireOn = dateOnly(addDays(expiresOn, -lead.days));
    if (fireOn.getTime() <= t.getTime()) out.push({ kind: lead.kind, on: fireOn });
  }
  if (daysBetween(t, expiresOn) < 0) out.push({ kind: "overdue", on: dateOnly(addDays(expiresOn, 1)) });
  return out;
}

/**
 * Dashboard buckets. A credential can be in more than one (≤30 is also ≤90).
 * "Never verified" and "verification due" apply only to PSV-required types, and an overdue
 * credential is reported as overdue rather than never-verified.
 */
export function bucketOf(
  c: { expiresOn: Date | null; nextVerifyDue: Date | null; verificationCount: number; psvRequired?: boolean },
  today: Date = new Date()
): { expiring30: boolean; expiring90: boolean; overdue: boolean; neverVerified: boolean; verifyDue: boolean } {
  const t = dateOnly(today);
  const left = c.expiresOn ? daysBetween(t, c.expiresOn) : null;
  const overdue = left !== null && left < 0;
  const psv = c.psvRequired ?? true;
  return {
    overdue,
    expiring30: left !== null && left >= 0 && left <= 30,
    expiring90: left !== null && left >= 0 && left <= 90,
    neverVerified: psv && !overdue && c.verificationCount === 0,
    verifyDue: psv && c.nextVerifyDue !== null && daysBetween(t, c.nextVerifyDue) <= 30,
  };
}
