"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentOrgId, db } from "@/lib/db";
import { recordVerification } from "@/lib/verifications";
import { runAutomatedVerification } from "@/lib/boards";
import { parseForm, withUser, zDate, zOptStr, type ActionState } from "@/lib/action";
import { fileKey, storage } from "@/lib/storage";
import { recomputeCredential } from "@/lib/credentials";
import { appUrl, credentialLabel, sendAlert } from "@/lib/alerts";
import { isoDate } from "@/lib/dates";

export async function autoVerifyAction(credentialId: string): Promise<ActionState> {
  let outcome: Awaited<ReturnType<typeof runAutomatedVerification>>;
  try {
    outcome = await withUser((s) => runAutomatedVerification(credentialId, s.userId));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/");
  revalidatePath("/verify");
  revalidatePath(`/credentials/${credentialId}`);
  if (!outcome.ok) return { error: outcome.error };
  redirect(`/credentials/${credentialId}?verified=auto`);
}

const schema = z.object({
  sourceUrl: z.string().url(),
  result: z.enum(["active", "expired", "suspended", "not_found", "mismatch"]),
  expirationSeen: zDate,
  disciplineFlag: z.string().optional().transform((v) => v === "on"),
  note: zOptStr,
  evidence: z.custom<File>((v) => v instanceof File && v.size > 0, "A screenshot of the board page is required"),
});

/**
 * Guided state-board verification submit.
 * 1. Store the screenshot with verifier, timestamp and board URL stamped in the object metadata.
 * 2. Insert the immutable verification row with a snapshot of what the system had.
 * 3. If the board shows a different expiration or a non-active status, update the credential,
 *    recompute status, and alert the compliance lead (status_change).
 * 4. next_verify_due moves to verified_at + reverify_days (done by recomputeCredential).
 */
export async function submitVerification(credentialId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  if (!/^image\//.test(d.evidence.type) && !/\.pdf$/i.test(d.evidence.name)) return { error: "Evidence must be an image (screenshot) or PDF" };
  try {
    await withUser(async (session) => {
      const c = await db.credential.findUniqueOrThrow({ where: { id: credentialId }, include: { credentialType: true, person: true, entity: true } });
      const orgId = currentOrgId();
      const ownerEntityId = c.person?.entityId ?? c.entityId ?? (await db.entity.findFirstOrThrow({ where: { isPrimary: true } })).id;
      const at = new Date();
      const vid = randomUUID();
      const ext = d.evidence.name.includes(".") ? d.evidence.name.slice(d.evidence.name.lastIndexOf(".")) : d.evidence.type === "image/png" ? ".png" : ".bin";
      const evidenceFileKey = fileKey(orgId, ownerEntityId, "verification", vid, `board-evidence${ext}`, at);
      await storage().put(evidenceFileKey, Buffer.from(await d.evidence.arrayBuffer()), {
        contentType: d.evidence.type || "application/octet-stream",
        metadata: { verifier: session.email, verified_at: at.toISOString(), source_url: d.sourceUrl, credential_id: credentialId, result: d.result },
      });

      // Verification row + one-credit debit in one transaction.
      await recordVerification({
        id: vid,
        orgId,
        credentialId,
        verifiedById: session.userId,
        verifiedAt: at,
        method: "manual_board",
        sourceUrl: d.sourceUrl,
        result: d.result,
        expirationSeen: d.expirationSeen,
        disciplineFlag: d.disciplineFlag,
        note: d.note,
        evidenceFileKey,
        statusBefore: c.status,
        expiresBefore: c.expiresOn,
      });

      // Apply what the board showed.
      const expiryChanged = d.expirationSeen !== null && (c.expiresOn === null || d.expirationSeen.getTime() !== c.expiresOn.getTime());
      if (expiryChanged) await db.credential.update({ where: { id: credentialId }, data: { expiresOn: d.expirationSeen } });
      const { status } = await recomputeCredential(credentialId, at);
      const statusChanged = status !== c.status;

      if (expiryChanged || statusChanged || d.disciplineFlag) {
        const label = credentialLabel(c);
        const lines = [
          `${session.name} verified ${label} against ${d.sourceUrl} on ${isoDate(at)}.`,
          `Board result: ${d.result}${d.disciplineFlag ? " — DISCIPLINARY FLAG" : ""}.`,
          expiryChanged ? `Expiration updated: ${c.expiresOn ? isoDate(c.expiresOn) : "none"} → ${isoDate(d.expirationSeen!)}.` : "",
          statusChanged ? `Status changed: ${c.status} → ${status}.` : "",
          d.note ? `Note: ${d.note}` : "",
          `Record: ${appUrl(`/credentials/${credentialId}`)}`,
        ].filter(Boolean);
        await sendAlert({
          credentialId,
          kind: "status_change",
          subject: `[Compliance] ${d.disciplineFlag ? "DISCIPLINE FLAG: " : ""}${label} — ${statusChanged ? `now ${status}` : "expiration updated"}`,
          body: lines.join("\n"),
          holderEmail: c.person?.email,
          sentAt: at,
        });
      }
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/");
  revalidatePath("/verify");
  revalidatePath(`/credentials/${credentialId}`);
  redirect(`/credentials/${credentialId}?verified=1`);
}
