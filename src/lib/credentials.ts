import type { CredentialStatus, Prisma, SubjectType } from "@prisma/client";
import { db } from "./db";
import { bucketOf, computeNextVerifyDue, computeStatus } from "./status";
import { dateOnly } from "./dates";

export const credentialInclude = {
  credentialType: true,
  person: { include: { entity: true } },
  entity: true,
  _count: { select: { verifications: true } },
} satisfies Prisma.CredentialInclude;

export type CredentialRow = Prisma.CredentialGetPayload<{ include: typeof credentialInclude }> & {
  buckets: ReturnType<typeof bucketOf>;
  holder: string;
  locationId: string | null;
  locationName: string;
};

export interface CredentialFilters {
  entityId?: string;
  personId?: string;
  typeId?: string;
  state?: string;
  status?: CredentialStatus;
  bucket?: "expiring30" | "expiring90" | "overdue" | "neverVerified" | "verifyDue";
  subjectType?: SubjectType;
  q?: string;
}

/** All credentials with dashboard buckets and display helpers, filtered in memory (a pharmacy group has hundreds, not millions). */
export async function loadCredentials(f: CredentialFilters = {}, today = new Date()): Promise<CredentialRow[]> {
  const rows = await db.credential.findMany({
    where: {
      ...(f.personId ? { personId: f.personId } : {}),
      ...(f.typeId ? { credentialTypeId: f.typeId } : {}),
      ...(f.state ? { state: f.state } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.subjectType ? { subjectType: f.subjectType } : {}),
    },
    include: credentialInclude,
    orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }],
  });
  const out: CredentialRow[] = rows.map((c) => {
    const location = c.person?.entity ?? c.entity ?? null;
    return {
      ...c,
      buckets: bucketOf({ expiresOn: c.expiresOn, nextVerifyDue: c.nextVerifyDue, verificationCount: c._count.verifications, psvRequired: c.credentialType.psvRequired }, today),
      holder: c.person ? `${c.person.firstName} ${c.person.lastName}` : (c.entity?.name ?? "—"),
      locationId: location?.id ?? null,
      locationName: location?.name ?? "—",
    };
  });
  const q = f.q?.trim().toLowerCase();
  return out.filter(
    (r) =>
      (!f.entityId || r.locationId === f.entityId) &&
      (!f.bucket || r.buckets[f.bucket]) &&
      (!q || `${r.holder} ${r.credentialType.name} ${r.number ?? ""} ${r.state ?? ""}`.toLowerCase().includes(q))
  );
}

/**
 * Recompute status and next_verify_due for one credential from its latest verification.
 * Called after every save, after every verification, and by the nightly job. Returns what changed.
 */
export async function recomputeCredential(id: string, today = new Date()) {
  const c = await db.credential.findUniqueOrThrow({
    where: { id },
    include: { credentialType: true, person: true, verifications: { orderBy: { verifiedAt: "desc" }, take: 1 } },
  });
  const latest = c.verifications[0] ?? null;
  const status = computeStatus({ expiresOn: c.expiresOn, renewalLeadDays: c.renewalLeadDays, latestResult: latest?.result ?? null }, today);
  let nextVerifyDue: Date | null = c.nextVerifyDue;
  if (!c.credentialType.psvRequired) nextVerifyDue = null;
  else if (latest) nextVerifyDue = computeNextVerifyDue(latest.verifiedAt, c.reverifyDays, c.createdAt);
  else if (!c.nextVerifyDue) nextVerifyDue = dateOnly(c.issuedOn ?? c.person?.hireDate ?? c.createdAt);

  const changed = status !== c.status || (nextVerifyDue?.getTime() ?? null) !== (c.nextVerifyDue?.getTime() ?? null);
  if (changed) await db.credential.update({ where: { id }, data: { status, nextVerifyDue } });
  return { before: c, status, nextVerifyDue, changed };
}

export async function formOptions() {
  const [types, people, entities, lookups] = await Promise.all([
    db.credentialType.findMany({ orderBy: { name: "asc" } }),
    db.person.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { entity: true } }),
    db.entity.findMany({ orderBy: [{ isPrimary: "desc" }, { name: "asc" }] }),
    db.boardLookup.findMany({ select: { state: true } }),
  ]);
  const states = [...new Set(lookups.map((l) => l.state))].sort();
  return { types, people, entities, states };
}

export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
