"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseForm, withAdmin, zOptStr, type ActionState } from "@/lib/action";
import { verifyNpi } from "@/lib/nppes";

const schema = z.object({
  name: z.string().trim().min(1),
  npi: zOptStr.refine((s) => s === null || /^\d{10}$/.test(s), "NPI must be 10 digits"),
  deaNumber: zOptStr,
  state: z.string().trim().length(2).toUpperCase(),
  address: z.string().trim().min(1),
  isPrimary: z.string().optional().transform((v) => v === "on"),
});

async function setPrimary(id: string) {
  await db.entity.updateMany({ where: { isPrimary: true, NOT: { id } }, data: { isPrimary: false } });
  await db.entity.update({ where: { id }, data: { isPrimary: true } });
}

export async function createEntity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  let id = "";
  try {
    id = await withAdmin(async () => {
      const count = await db.entity.count();
      const e = await db.entity.create({ data: { ...d, isPrimary: false } });
      if (d.isPrimary || count === 0) await setPrimary(e.id);
      if (d.npi) await verifyNpi({ entityId: e.id }).catch((err) => console.error("NPPES:", err.message));
      return e.id;
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/entities");
  redirect(`/entities/${id}`);
}

export async function updateEntity(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withAdmin(async () => {
      const before = await db.entity.findUniqueOrThrow({ where: { id } });
      await db.entity.update({ where: { id }, data: { name: d.name, npi: d.npi, deaNumber: d.deaNumber, state: d.state, address: d.address } });
      if (d.isPrimary && !before.isPrimary) await setPrimary(id);
      if (d.npi && d.npi !== before.npi) await verifyNpi({ entityId: id }).catch((err) => console.error("NPPES:", err.message));
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/entities");
  redirect(`/entities/${id}`);
}
