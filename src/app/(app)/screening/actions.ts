"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withOrgAdmin, parseForm, zOptStr, type ActionState } from "@/lib/action";
import { runScreening } from "@/lib/screening";

export async function runScreeningNow(source: "oig_leie" | "sam"): Promise<ActionState> {
  try {
    await withOrgAdmin(() => runScreening(source));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/screening");
  return { ok: true };
}

const dispositionSchema = z.object({
  matchId: z.string().min(1),
  disposition: z.enum(["false_positive", "confirmed"]),
  reviewNote: zOptStr,
});

export async function setDisposition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(dispositionSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withOrgAdmin(async (session) => {
      await db.screeningMatch.update({
        where: { id: d.matchId },
        data: { disposition: d.disposition, reviewNote: d.reviewNote, reviewedById: session.userId, reviewedAt: new Date() },
      });
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/screening/matches");
  revalidatePath("/screening");
  return { ok: true };
}
