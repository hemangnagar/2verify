"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentOrgId, db } from "@/lib/db";
import { parseForm, withOrgAdmin, withUser, zDate, zFile, zInt, zOptStr, type ActionState } from "@/lib/action";
import { fileKey, storage } from "@/lib/storage";
import { recomputeCredential } from "@/lib/credentials";

const schema = z.object({
  subjectType: z.enum(["person", "entity"]),
  personId: zOptStr,
  entityId: zOptStr,
  credentialTypeId: z.string().min(1),
  state: zOptStr,
  number: zOptStr,
  issuedOn: zDate,
  expiresOn: zDate,
  renewalLeadDays: zInt,
  reverifyDays: zInt,
  notes: zOptStr,
  document: zFile,
});

async function storeDocument(ownerEntityId: string, credentialId: string, file: File) {
  const key = fileKey(currentOrgId(), ownerEntityId, "credential", credentialId, file.name);
  await storage().put(key, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", metadata: { kind: "credential-document" } });
  return key;
}

async function ownerEntity(subjectType: "person" | "entity", personId: string | null, entityId: string | null) {
  if (subjectType === "entity") {
    if (!entityId) throw new Error("Select a location");
    return entityId;
  }
  if (!personId) throw new Error("Select a person");
  const p = await db.person.findUniqueOrThrow({ where: { id: personId } });
  if (p.entityId) return p.entityId;
  const primary = await db.entity.findFirst({ where: { isPrimary: true } });
  return primary?.id ?? (await db.entity.findFirstOrThrow()).id;
}

export async function createCredential(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  let id = "";
  try {
    id = await withUser(async () => {
      const owner = await ownerEntity(d.subjectType, d.personId, d.entityId);
      const type = await db.credentialType.findUniqueOrThrow({ where: { id: d.credentialTypeId } });
      const c = await db.credential.create({
        data: {
          orgId: currentOrgId(),
          subjectType: d.subjectType,
          personId: d.subjectType === "person" ? d.personId : null,
          entityId: d.subjectType === "entity" ? d.entityId : null,
          credentialTypeId: d.credentialTypeId,
          state: type.stateSpecific ? d.state : null,
          number: d.number,
          issuedOn: d.issuedOn,
          expiresOn: d.expiresOn,
          renewalLeadDays: d.renewalLeadDays,
          reverifyDays: d.reverifyDays,
          notes: d.notes,
        },
      });
      if (d.document) {
        const key = await storeDocument(owner, c.id, d.document);
        await db.credential.update({ where: { id: c.id }, data: { documentFileKey: key } });
      }
      await recomputeCredential(c.id);
      return c.id;
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/");
  redirect(`/credentials/${id}`);
}

export async function updateCredential(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withUser(async () => {
      const owner = await ownerEntity(d.subjectType, d.personId, d.entityId);
      const type = await db.credentialType.findUniqueOrThrow({ where: { id: d.credentialTypeId } });
      const data: Parameters<typeof db.credential.update>[0]["data"] = {
        subjectType: d.subjectType,
        personId: d.subjectType === "person" ? d.personId : null,
        entityId: d.subjectType === "entity" ? d.entityId : null,
        credentialTypeId: d.credentialTypeId,
        state: type.stateSpecific ? d.state : null,
        number: d.number,
        issuedOn: d.issuedOn,
        expiresOn: d.expiresOn,
        renewalLeadDays: d.renewalLeadDays,
        reverifyDays: d.reverifyDays,
        notes: d.notes,
      };
      if (d.document) data.documentFileKey = await storeDocument(owner, id, d.document);
      await db.credential.update({ where: { id }, data });
      await recomputeCredential(id);
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/");
  revalidatePath(`/credentials/${id}`);
  redirect(`/credentials/${id}`);
}

/** Admin only. Verifications are insert-only, so a credential with evidence cannot be deleted; it is kept for the record. */
export async function deleteCredential(id: string) {
  await withOrgAdmin(async () => {
    const n = await db.verification.count({ where: { credentialId: id } });
    if (n > 0) throw new Error("This credential has verification evidence and cannot be deleted. Set an expiry in the past or mark the person inactive instead.");
    await db.credential.delete({ where: { id } });
  });
  revalidatePath("/");
  redirect("/credentials");
}
