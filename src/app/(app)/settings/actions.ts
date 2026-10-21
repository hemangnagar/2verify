"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseForm, withAdmin, zInt, zOptStr } from "@/lib/action";

const typeSchema = z.object({
  defaultLeadDays: zInt,
  defaultReverifyDays: z.coerce.number().int().min(1),
  psvRequired: z.string().optional().transform((v) => v === "on"),
  requiredForRoles: z.array(z.enum(["pharmacist", "technician", "intern", "prescriber", "staff"])).optional(),
});

export async function updateCredentialType(id: string, formData: FormData) {
  const parsed = parseForm(typeSchema, formData);
  if ("error" in parsed) throw new Error(parsed.error);
  const d = parsed.data;
  await withAdmin(async () => {
    const t = await db.credentialType.findUniqueOrThrow({ where: { id } });
    await db.credentialType.update({
      where: { id },
      data: { defaultLeadDays: d.defaultLeadDays, defaultReverifyDays: d.defaultReverifyDays, psvRequired: d.psvRequired, requiredForRoles: t.category === "training" ? (d.requiredForRoles ?? []) : t.requiredForRoles },
    });
  });
  revalidatePath("/settings/credential-types");
}

const lookupSchema = z.object({
  state: z.string().length(2).toUpperCase(),
  credentialTypeId: z.string().min(1),
  boardName: z.string().trim().min(1),
  urlTemplate: z.string().trim().url(),
  notes: zOptStr,
});

export async function upsertBoardLookup(formData: FormData) {
  const parsed = parseForm(lookupSchema, formData);
  if ("error" in parsed) throw new Error(parsed.error);
  const d = parsed.data;
  await withAdmin(async () => {
    await db.boardLookup.upsert({
      where: { state_credentialTypeId: { state: d.state, credentialTypeId: d.credentialTypeId } },
      create: d,
      update: { boardName: d.boardName, urlTemplate: d.urlTemplate, notes: d.notes },
    });
  });
  revalidatePath("/settings/board-lookups");
}

export async function deleteBoardLookup(id: string) {
  await withAdmin(async () => {
    await db.boardLookup.delete({ where: { id } });
  });
  revalidatePath("/settings/board-lookups");
}
