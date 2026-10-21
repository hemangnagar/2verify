import type { AlertKind } from "@prisma/client";
import { db } from "./db";
import { recomputeCredential } from "./credentials";
import { expiryAlertsDueBy } from "./status";
import { dateOnly, daysBetween, isoDate } from "./dates";
import { appUrl, credentialLabel, sendAlert } from "./alerts";

export interface NightlyResult {
  credentials: number;
  statusChanges: number;
  alertsSent: number;
  verifyDueAlerts: number;
  skippedAlreadySent: number;
}

/**
 * Nightly job:
 *  1. Recompute status and next_verify_due for every credential.
 *  2. Send expiry alerts (90/60/30/7-day leads and overdue) that have not been sent for the
 *     credential's current expiry cycle. "Already sent" = an alert of that kind exists with
 *     sent_at on or after the day it was due to fire; a renewal moves the fire date forward,
 *     so the next cycle's alerts go out again.
 *  3. Send one verify_due alert when primary-source verification is overdue, once per due date.
 */
export async function runNightly(today: Date = new Date()): Promise<NightlyResult> {
  const t = dateOnly(today);
  const result: NightlyResult = { credentials: 0, statusChanges: 0, alertsSent: 0, verifyDueAlerts: 0, skippedAlreadySent: 0 };
  const ids = await db.credential.findMany({ select: { id: true } });

  for (const { id } of ids) {
    result.credentials++;
    const r = await recomputeCredential(id, today);
    if (r.changed && r.status !== r.before.status) result.statusChanges++;

    const c = await db.credential.findUniqueOrThrow({ where: { id }, include: { credentialType: true, person: true, entity: true, alerts: true } });
    const label = credentialLabel(c);
    const link = appUrl(`/credentials/${c.id}`);

    if (c.expiresOn) {
      for (const due of expiryAlertsDueBy(c.expiresOn, t)) {
        if (alreadySent(c.alerts, due.kind, due.on)) {
          result.skippedAlreadySent++;
          continue;
        }
        const left = daysBetween(t, c.expiresOn);
        const subject =
          due.kind === "overdue"
            ? `[Compliance] OVERDUE: ${label} expired ${isoDate(c.expiresOn)}`
            : `[Compliance] ${label} expires in ${left} day${left === 1 ? "" : "s"} (${isoDate(c.expiresOn)})`;
        const body = [
          due.kind === "overdue" ? `${label} expired on ${isoDate(c.expiresOn)} and is now ${c.status}.` : `${label} expires on ${isoDate(c.expiresOn)}, ${left} days from now.`,
          c.notes ? `Notes: ${c.notes}` : "",
          `Record: ${link}`,
        ].filter(Boolean);
        const n = await sendAlert({ credentialId: c.id, kind: due.kind, subject, body: body.join("\n"), holderEmail: c.person?.email });
        if (n) result.alertsSent++;
      }
    }

    if (c.credentialType.psvRequired && c.nextVerifyDue && daysBetween(t, c.nextVerifyDue) <= 0) {
      if (!alreadySent(c.alerts, "verify_due", c.nextVerifyDue)) {
        const n = await sendAlert({
          credentialId: c.id,
          kind: "verify_due",
          subject: `[Compliance] Verification due: ${label}`,
          body: `${label} is due for primary-source verification (due ${isoDate(c.nextVerifyDue)}).\nQueue: ${appUrl("/verify")}\nVerify: ${appUrl(`/verify/${c.id}`)}`,
          holderEmail: null,
        });
        if (n) result.verifyDueAlerts++;
      } else result.skippedAlreadySent++;
    }
  }
  return result;
}

export function alreadySent(alerts: Array<{ kind: AlertKind; sentAt: Date }>, kind: AlertKind, dueOn: Date): boolean {
  const due = dateOnly(dueOn).getTime();
  return alerts.some((a) => a.kind === kind && a.sentAt.getTime() >= due);
}
