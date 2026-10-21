import type { AlertKind } from "@prisma/client";
import { currentOrgId, db } from "./db";
import { alertCcList, sendMail } from "./email";

/**
 * Send one alert about a credential: writes an alert row per recipient after the email goes out.
 * Recipients: every active admin user, ALERT_CC, and the credential holder when they have an email.
 * Returns the number of recipients written. Email failure is logged and the alert is not recorded,
 * so the nightly job retries it next run.
 */
export async function sendAlert(opts: {
  credentialId: string;
  kind: AlertKind;
  subject: string;
  body: string;
  holderEmail?: string | null;
  sentAt?: Date;
}): Promise<number> {
  const orgId = currentOrgId();
  const admins = await db.user.findMany({ where: { role: "org_admin", orgId, active: true }, select: { email: true } });
  const recipients = [...new Set([...(opts.holderEmail ? [opts.holderEmail] : []), ...alertCcList(), ...admins.map((a) => a.email)])];
  if (!recipients.length) return 0;
  try {
    await sendMail({ to: recipients, subject: opts.subject, text: opts.body });
  } catch (e) {
    console.error(`[alerts] send failed for ${opts.kind} on ${opts.credentialId}:`, (e as Error).message);
    return 0;
  }
  for (const to of recipients) {
    await db.alert.create({ data: { orgId, credentialId: opts.credentialId, sentTo: to, kind: opts.kind, subject: opts.subject, sentAt: opts.sentAt ?? new Date() } });
  }
  return recipients.length;
}

export function credentialLabel(c: { state: string | null; number: string | null; credentialType: { name: string }; person?: { firstName: string; lastName: string } | null; entity?: { name: string } | null }) {
  const holder = c.person ? `${c.person.firstName} ${c.person.lastName}` : (c.entity?.name ?? "");
  return `${c.state ? c.state + " " : ""}${c.credentialType.name} for ${holder}${c.number ? ` (#${c.number})` : ""}`;
}

export function appUrl(path: string) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
}
