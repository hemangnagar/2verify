"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, switchActiveOrg } from "@/lib/auth";
import { parseForm, withOperator, zOptStr, type ActionState } from "@/lib/action";
import { postCredits } from "@/lib/verifications";
import { sendMail } from "@/lib/email";
import { brand } from "@/config/brand";
import { appUrl } from "@/lib/alerts";
import { dateOnly } from "@/lib/dates";

export async function switchIntoOrgAction(orgId: string) {
  await switchActiveOrg(orgId);
  redirect("/");
}

export async function exitOrgAction() {
  await switchActiveOrg(null);
  redirect("/ops");
}

const orgSchema = z.object({
  name: z.string().trim().min(2),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes"),
  planId: z.string().min(1),
  status: z.enum(["trial", "active", "suspended"]),
  states: z.array(z.string().length(2)).optional(),
  adminName: z.string().trim().min(1),
  adminEmail: z.string().trim().toLowerCase().email(),
});

export async function createOrgAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(orgSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  let id = "";
  let message = "";
  try {
    await withOperator(async (op) => {
      const plan = await db.plan.findUniqueOrThrow({ where: { id: d.planId } });
      if (await db.user.findUnique({ where: { email: d.adminEmail } })) throw new Error("A user with that email already exists");
      const org = await db.org.create({
        data: { name: d.name, slug: d.slug, planId: plan.id, status: d.status, subscribedStates: [...new Set(d.states ?? [])].sort(), termStartsOn: dateOnly(new Date()) },
      });
      id = org.id;
      for (const st of org.subscribedStates) await db.orgJurisdiction.create({ data: { orgId: org.id, state: st, addedOn: dateOnly(new Date()), note: "Subscribed at onboarding" } });
      if (plan.creditsPerYear > 0) await postCredits({ orgId: org.id, delta: plan.creditsPerYear, reason: "allotment", note: `Annual allotment (${plan.name})`, createdById: op.userId });
      const tempPassword = randomBytes(9).toString("base64url");
      await db.user.create({ data: { orgId: org.id, email: d.adminEmail, name: d.adminName, role: "org_admin", passwordHash: await hashPassword(tempPassword) } });
      try {
        await sendMail({
          to: d.adminEmail,
          subject: `Your ${brand.name} account for ${org.name}`,
          text: [`${d.adminName},`, "", `Your ${brand.name} organization "${org.name}" is ready.`, `Sign in at ${appUrl("/login")} with this email and the temporary password: ${tempPassword}`, "", brand.tagline].join("\n"),
        });
        message = `Invite emailed to ${d.adminEmail}. Temporary password (shown once): ${tempPassword}`;
      } catch (e) {
        message = `Org created, but the invite email failed (${(e as Error).message}). Temporary password for ${d.adminEmail}: ${tempPassword}`;
      }
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/ops");
  redirect(`/ops/orgs/${id}?msg=${encodeURIComponent(message)}`);
}

const adjustSchema = z.object({ delta: z.coerce.number().int().refine((n) => n !== 0, "delta cannot be 0"), reason: z.enum(["adjustment", "overage", "allotment"]), note: zOptStr });

export async function adjustCreditsAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(adjustSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withOperator(async (op) => {
      await postCredits({ orgId, delta: d.delta, reason: d.reason, note: d.note, createdById: op.userId });
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/ops/orgs/${orgId}`);
  return { ok: true, message: `Posted ${d.delta > 0 ? "+" : ""}${d.delta} credits (${d.reason}).` };
}

export async function renewTermAction(orgId: string) {
  await withOperator(async (op) => {
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, include: { plan: true } });
    await db.org.update({ where: { id: orgId }, data: { termStartsOn: dateOnly(new Date()), status: org.status === "trial" ? "active" : org.status } });
    if (org.plan.creditsPerYear > 0) await postCredits({ orgId, delta: org.plan.creditsPerYear, reason: "allotment", note: `Annual allotment (${org.plan.name}) — term renewed`, createdById: op.userId });
  });
  revalidatePath(`/ops/orgs/${orgId}`);
  revalidatePath("/ops");
}

export async function setOrgStatusAction(orgId: string, status: "trial" | "active" | "suspended") {
  await withOperator(async () => {
    await db.org.update({ where: { id: orgId }, data: { status } });
  });
  revalidatePath(`/ops/orgs/${orgId}`);
  revalidatePath("/ops");
}

const jurisdictionSchema = z.object({ state: z.string().trim().toUpperCase().length(2), note: zOptStr });

/** Operator adds a jurisdiction to a customer: history row, current set for pricing, and a note of what was set up. */
export async function addJurisdictionAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(jurisdictionSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  try {
    await withOperator(async () => {
      const org = await db.org.findUniqueOrThrow({ where: { id: orgId } });
      if (org.subscribedStates.includes(d.state)) throw new Error(`${d.state} is already subscribed`);
      if (org.subscribedStates.length >= 51) throw new Error("Maximum of 51 jurisdictions");
      await db.org.update({ where: { id: orgId }, data: { subscribedStates: [...org.subscribedStates, d.state].sort() } });
      await db.orgJurisdiction.upsert({
        where: { orgId_state: { orgId, state: d.state } },
        create: { orgId, state: d.state, addedOn: dateOnly(new Date()), note: d.note ?? "Added by 2Verify" },
        update: { addedOn: dateOnly(new Date()), removedOn: null, note: d.note ?? "Re-added by 2Verify" },
      });
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/ops/orgs/${orgId}`);
  revalidatePath("/ops");
  return { ok: true, message: `${d.state} added. Board lookups for ${d.state} must exist under Settings → Board lookups before the queue can route its licenses.` };
}
