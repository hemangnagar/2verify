import { randomUUID } from "node:crypto";
import type { CredentialStatus, VerificationMethod, VerificationResult } from "@prisma/client";
import { db } from "./db";

export interface VerificationInput {
  id?: string;
  orgId: string;
  credentialId: string;
  verifiedById: string | null;
  verifiedAt?: Date;
  method: VerificationMethod;
  sourceUrl: string;
  result: VerificationResult;
  expirationSeen: Date | null;
  disciplineFlag: boolean;
  note: string | null;
  evidenceFileKey: string | null;
  statusBefore: CredentialStatus | null;
  expiresBefore: Date | null;
}

/**
 * The only way a verification row is written. One transaction:
 *   lock the org row → insert the verification → insert the ledger debit with the running balance.
 * Evidence files are stored before this is called and referenced by key.
 * Screening never calls this; it does not consume credits.
 */
export async function recordVerification(input: VerificationInput): Promise<{ verificationId: string; balanceAfter: number }> {
  const id = input.id ?? randomUUID();
  const at = input.verifiedAt ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "org" WHERE id = ${input.orgId} FOR NO KEY UPDATE`;
    await tx.verification.create({
      data: {
        id,
        orgId: input.orgId,
        credentialId: input.credentialId,
        verifiedById: input.verifiedById,
        verifiedAt: at,
        method: input.method,
        sourceUrl: input.sourceUrl,
        result: input.result,
        expirationSeen: input.expirationSeen,
        disciplineFlag: input.disciplineFlag,
        note: input.note,
        evidenceFileKey: input.evidenceFileKey,
        statusBefore: input.statusBefore,
        expiresBefore: input.expiresBefore,
      },
    });
    const last = await tx.creditLedger.findFirst({ where: { orgId: input.orgId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const balanceAfter = (last?.balanceAfter ?? 0) - 1;
    await tx.creditLedger.create({
      data: { orgId: input.orgId, delta: -1, reason: "verification", verificationId: id, balanceAfter, createdAt: at },
    });
    return { verificationId: id, balanceAfter };
  });
}

/** Operator credit movement (allotment, adjustment, overage pack). Positive or negative delta. */
export async function postCredits(input: { orgId: string; delta: number; reason: "allotment" | "adjustment" | "overage"; note: string | null; createdById: string | null; at?: Date }) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "org" WHERE id = ${input.orgId} FOR NO KEY UPDATE`;
    const last = await tx.creditLedger.findFirst({ where: { orgId: input.orgId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const balanceAfter = (last?.balanceAfter ?? 0) + input.delta;
    return tx.creditLedger.create({ data: { orgId: input.orgId, delta: input.delta, reason: input.reason, note: input.note, createdById: input.createdById, balanceAfter, createdAt: input.at ?? new Date() } });
  });
}
