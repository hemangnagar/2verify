import { randomUUID } from "node:crypto";
import type { Credential, CredentialType, Entity, Person } from "@prisma/client";
import { db } from "../db";
import { fileKey, storage } from "../storage";
import { recordVerification } from "../verifications";
import { recomputeCredential } from "../credentials";
import { credentialLabel, appUrl, sendAlert } from "../alerts";
import { isoDate } from "../dates";
import { txPharmacyPermit } from "./tx";
import { BoardLayoutError, type BoardAdapter, type BoardLicenseType, type BoardResult } from "./types";

/** Every adapter the codebase knows. A row in board_adapter (state + type → key) enables one. */
export const ADAPTERS: Record<string, BoardAdapter> = {
  [txPharmacyPermit.key]: txPharmacyPermit,
};

export function adaptersEnabled(): boolean {
  return (process.env.BOARD_ADAPTERS ?? "on") !== "off";
}

const TYPE_TO_LICENSE: Record<string, BoardLicenseType> = {
  "Pharmacy Permit": "pharmacy_permit",
  "Nonresident Pharmacy Permit": "pharmacy_permit",
  "Pharmacist License": "pharmacist",
  "Pharmacy Technician License": "technician",
  "Prescriber State License": "prescriber",
};

/** The enabled adapter for a credential's (state, type), or null → guided workbench. */
export async function adapterFor(c: { state: string | null; credentialTypeId: string }) {
  if (!c.state || !adaptersEnabled()) return null;
  const row = await db.boardAdapter.findUnique({ where: { state_credentialTypeId: { state: c.state, credentialTypeId: c.credentialTypeId } }, include: { credentialType: true } });
  if (!row || !row.enabled) return null;
  const adapter = ADAPTERS[row.adapter];
  if (!adapter) return null;
  return { row, adapter, licenseType: TYPE_TO_LICENSE[row.credentialType.name] ?? ("pharmacy_permit" as BoardLicenseType) };
}

/** Map of "STATE:credentialTypeId" → adapter key for every enabled adapter (queue badges). */
export async function enabledAdapterMap(): Promise<Map<string, string>> {
  if (!adaptersEnabled()) return new Map();
  const rows = await db.boardAdapter.findMany({ where: { enabled: true } });
  return new Map(rows.filter((r) => ADAPTERS[r.adapter]).map((r) => [`${r.state}:${r.credentialTypeId}`, r.adapter]));
}

// Polite rate limit: one query per adapter per min_interval_sec, process-wide.
const lastQueryAt = new Map<string, number>();
async function politeWait(key: string, minIntervalSec: number) {
  const last = lastQueryAt.get(key) ?? 0;
  const wait = last + minIntervalSec * 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastQueryAt.set(key, Date.now());
}

export interface AutoVerifyOutcome {
  ok: boolean;
  verificationId?: string;
  result?: BoardResult["status"];
  changed?: boolean;
  error?: string;
}

/**
 * Run the automated board verification for one credential, end to end:
 * adapter lookup (with one retry) → evidence (screenshot PNG + raw text JSON) to storage →
 * verification row + credit debit in one transaction → credential update if the board disagrees →
 * status_change alert → next_verify_due. On failure the credential stays in the manual queue with
 * the error recorded on it and on the adapter.
 */
export async function runAutomatedVerification(credentialId: string, actorUserId: string | null): Promise<AutoVerifyOutcome> {
  const c = await db.credential.findUniqueOrThrow({ where: { id: credentialId }, include: { credentialType: true, person: true, entity: true } });
  const found = await adapterFor(c);
  if (!found) return { ok: false, error: `No automated adapter for ${c.state ?? "—"} ${c.credentialType.name}` };
  if (!c.number) return { ok: false, error: "Credential has no license number" };
  const { row, adapter, licenseType } = found;
  const attemptAt = new Date();

  let result: BoardResult | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      await politeWait(adapter.key, row.minIntervalSec);
      result = await adapter.verify({ licenseNumber: c.number, lastName: c.person?.lastName, licenseType });
    } catch (e) {
      lastErr = e as Error;
      if (e instanceof BoardLayoutError) break; // retrying a layout change is pointless
    }
  }
  if (!result) {
    const message = lastErr?.message ?? "unknown adapter failure";
    await db.credential.update({ where: { id: c.id }, data: { lastAutoAttemptAt: attemptAt, lastAutoError: message } });
    await db.boardAdapter.update({ where: { id: row.id }, data: { lastError: message, lastErrorAt: attemptAt } });
    return { ok: false, error: message };
  }

  return applyBoardResult(c, result, { adapterKey: adapter.key, adapterRowId: row.id, actorUserId, attemptAt });
}

/** Shared by the live adapter and tests: persist a board result as evidence + verification + updates. */
export async function applyBoardResult(
  c: Credential & { credentialType: CredentialType; person: Person | null; entity: Entity | null },
  result: BoardResult,
  ctx: { adapterKey: string; adapterRowId: string | null; actorUserId: string | null; attemptAt: Date }
): Promise<AutoVerifyOutcome> {
  const ownerEntityId = c.person?.entityId ?? c.entityId ?? (await db.entity.findFirstOrThrow({ where: { isPrimary: true } })).id;
  const vid = randomUUID();
  const meta = { verifier: "system:" + ctx.adapterKey, verified_at: result.fetchedAt.toISOString(), source_url: result.sourceUrl, credential_id: c.id, result: result.status };
  const screenshotKey = fileKey(c.orgId, ownerEntityId, "verification", vid, "board-screenshot.png", result.fetchedAt);
  await storage().put(screenshotKey, result.screenshotPng, { contentType: "image/png", metadata: meta });
  const rawKey = fileKey(c.orgId, ownerEntityId, "verification", vid, "board-page.json", result.fetchedAt);
  await storage().put(
    rawKey,
    JSON.stringify({ adapter: ctx.adapterKey, sourceUrl: result.sourceUrl, fetchedAt: result.fetchedAt.toISOString(), holderName: result.holderName, statusText: result.statusText, expirationSeen: result.expirationSeen, disciplineFlag: result.disciplineFlag, rawText: result.rawText }, null, 2),
    { contentType: "application/json", metadata: meta }
  );

  const holderOnFile = c.person ? `${c.person.firstName} ${c.person.lastName}` : (c.entity?.name ?? "");
  const note = [
    `Automated lookup (${ctx.adapterKey}).`,
    result.statusText ? `Board status: "${result.statusText}".` : "",
    result.holderName ? `Board shows holder: ${result.holderName}.` : "",
    result.holderName && holderOnFile && !result.holderName.toUpperCase().includes(holderOnFile.split(" ").pop()!.toUpperCase()) ? "Holder name on the board differs from the record; review." : "",
  ]
    .filter(Boolean)
    .join(" ");

  await recordVerification({
    id: vid,
    orgId: c.orgId,
    credentialId: c.id,
    verifiedById: null,
    verifiedAt: result.fetchedAt,
    method: "auto_board",
    sourceUrl: result.sourceUrl,
    result: result.status,
    expirationSeen: result.expirationSeen,
    disciplineFlag: result.disciplineFlag,
    note,
    evidenceFileKey: screenshotKey,
    statusBefore: c.status,
    expiresBefore: c.expiresOn,
  });

  const expiryChanged = result.expirationSeen !== null && (c.expiresOn === null || result.expirationSeen.getTime() !== c.expiresOn.getTime());
  await db.credential.update({ where: { id: c.id }, data: { lastAutoAttemptAt: ctx.attemptAt, lastAutoError: null, ...(expiryChanged ? { expiresOn: result.expirationSeen } : {}) } });
  const { status } = await recomputeCredential(c.id, result.fetchedAt);
  const statusChanged = status !== c.status;
  if (ctx.adapterRowId) await db.boardAdapter.update({ where: { id: ctx.adapterRowId }, data: { lastSuccessAt: result.fetchedAt, lastError: null } });

  if (expiryChanged || statusChanged || result.disciplineFlag) {
    const label = credentialLabel(c);
    await sendAlert({
      credentialId: c.id,
      kind: "status_change",
      subject: `[Compliance] ${result.disciplineFlag ? "DISCIPLINE FLAG: " : ""}${label} — ${statusChanged ? `now ${status}` : "expiration updated"} (automated board check)`,
      body: [
        `Automated verification against ${result.sourceUrl} on ${isoDate(result.fetchedAt)}.`,
        `Board result: ${result.status}${result.statusText ? ` ("${result.statusText}")` : ""}${result.disciplineFlag ? " — DISCIPLINARY ORDERS ON FILE" : ""}.`,
        expiryChanged ? `Expiration updated: ${c.expiresOn ? isoDate(c.expiresOn) : "none"} → ${isoDate(result.expirationSeen!)}.` : "",
        statusChanged ? `Status changed: ${c.status} → ${status}.` : "",
        `Record: ${appUrl(`/credentials/${c.id}`)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      holderEmail: c.person?.email,
      sentAt: result.fetchedAt,
    });
  }
  return { ok: true, verificationId: vid, result: result.status, changed: expiryChanged || statusChanged };
}
