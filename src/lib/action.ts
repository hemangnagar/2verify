import "server-only";
import { z } from "zod";
import { auditContext } from "./db";
import { requireAdmin, requireSession, type Session } from "./auth";

/** Runs `fn` as the signed-in user with the audit context set, so every write is attributed. */
export async function withUser<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const s = await requireSession();
  return auditContext.run({ userId: s.userId }, () => fn(s));
}

export async function withAdmin<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const s = await requireAdmin();
  return auditContext.run({ userId: s.userId }, () => fn(s));
}

export type ActionState = { error?: string; ok?: boolean } | undefined;

/** Parse FormData with a zod schema; returns the error string for the form on failure. */
export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): { data: z.infer<T> } | { error: string } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      (raw[key] ??= []) as unknown[];
      (raw[key] as unknown[]).push(v);
    } else raw[k] = v;
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    return { error: `${first.path.join(".") || "form"}: ${first.message}` };
  }
  return { data: res.data };
}

/** Helpers for optional form fields. A field that is not rendered arrives as undefined; an empty input as "". */
export const zDate = z
  .string()
  .optional()
  .transform((s) => (s?.trim() ? new Date(s.trim() + "T00:00:00Z") : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "invalid date");
export const zOptStr = z
  .string()
  .optional()
  .transform((s) => (s?.trim() ? s.trim() : null));
export const zInt = z.coerce.number().int().min(0);
/** A file input with nothing chosen submits an empty File; treat it as absent. */
export const zFile = z.any().transform((v) => (typeof File !== "undefined" && v instanceof File && v.size > 0 ? (v as File) : undefined));
