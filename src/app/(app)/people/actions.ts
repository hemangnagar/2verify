"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentOrgId, db } from "@/lib/db";
import { parseForm, withUser, zDate, zOptStr, type ActionState } from "@/lib/action";
import { verifyNpi } from "@/lib/nppes";

const schema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: zOptStr.transform((s) => s?.toLowerCase() ?? null),
  role: z.enum(["pharmacist", "technician", "intern", "prescriber", "staff"]),
  entityId: zOptStr,
  dob: zDate,
  npi: zOptStr.refine((s) => s === null || /^\d{10}$/.test(s), "NPI must be 10 digits"),
  hireDate: zDate,
  active: z.string().optional().transform((v) => v === "on"),
});

async function afterSave(personId: string, npiChanged: boolean): Promise<string | null> {
  if (!npiChanged) return null;
  try {
    const r = await verifyNpi({ personId });
    return r.skipped ? null : `NPPES: ${r.result}`;
  } catch (e) {
    return `NPPES lookup failed: ${(e as Error).message}`;
  }
}

export async function createPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  let id = "";
  try {
    id = await withUser(async () => {
      const p = await db.person.create({ data: { ...d, orgId: currentOrgId(), entityId: d.entityId } });
      await afterSave(p.id, !!d.npi);
      return p.id;
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/people");
  redirect(`/people/${id}`);
}

export async function updatePerson(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withUser(async () => {
      const before = await db.person.findUniqueOrThrow({ where: { id } });
      await db.person.update({ where: { id }, data: { ...d, entityId: d.entityId } });
      await afterSave(id, !!d.npi && d.npi !== before.npi);
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  redirect(`/people/${id}`);
}

export async function reverifyPersonNpi(id: string) {
  await withUser(async () => {
    await verifyNpi({ personId: id });
  });
  revalidatePath(`/people/${id}`);
}
