/**
 * Integration tests against the dev database (DATABASE_URL). Run with `make test-int`.
 * Proves cross-org reads and writes fail through the scoped client, and that the ledger invariant
 * holds for every org in the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, dbRaw, OrgScopeError, withScope } from "./db";
import { recordVerification } from "./verifications";
import { checkLedger } from "./pricing";

const stamp = Date.now().toString(36);
let orgA: string, orgB: string, personA: string, personB: string, credA: string, credB: string;

beforeAll(async () => {
  const plan = await dbRaw.plan.findUniqueOrThrow({ where: { name: "Core" } });
  const type = await dbRaw.credentialType.findFirstOrThrow({ where: { psvRequired: true } });
  const mk = async (slug: string) => {
    const org = await dbRaw.org.create({ data: { name: `Test ${slug}`, slug: `${slug}-${stamp}`, planId: plan.id, status: "active", termStartsOn: new Date(), isDemo: true } });
    await dbRaw.creditLedger.create({ data: { orgId: org.id, delta: 240, reason: "allotment", balanceAfter: 240 } });
    const p = await dbRaw.person.create({ data: { orgId: org.id, firstName: "Pat", lastName: slug, role: "pharmacist" } });
    const c = await dbRaw.credential.create({ data: { orgId: org.id, subjectType: "person", personId: p.id, credentialTypeId: type.id, state: "TX", number: `${slug}-1`, renewalLeadDays: 90, reverifyDays: 365 } });
    return [org.id, p.id, c.id];
  };
  [orgA, personA, credA] = await mk("alpha");
  [orgB, personB, credB] = await mk("beta");
});

afterAll(async () => {
  await dbRaw.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_wipe = 'on'`);
    await tx.creditLedger.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
    await tx.verification.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
    await tx.auditLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
    await tx.org.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  });
  await dbRaw.$disconnect();
});

const asA = <T>(fn: () => Promise<T>) => withScope({ orgId: orgA, role: "org_admin" }, fn);

describe("org isolation", () => {
  it("findMany only returns the org's rows", async () => {
    const people = await asA(() => db.person.findMany());
    expect(people.map((p) => p.id)).toEqual([personA]);
  });
  it("findUnique by another org's id returns null", async () => {
    expect(await asA(() => db.person.findUnique({ where: { id: personB } }))).toBeNull();
    expect(await asA(() => db.credential.findUnique({ where: { id: credB } }))).toBeNull();
  });
  it("update and delete of another org's row fail", async () => {
    await expect(asA(() => db.person.update({ where: { id: personB }, data: { firstName: "X" } }))).rejects.toThrow();
    await expect(asA(() => db.credential.delete({ where: { id: credB } }))).rejects.toThrow();
    expect((await dbRaw.person.findUniqueOrThrow({ where: { id: personB } })).firstName).toBe("Pat");
  });
  it("create that names another org is refused, and a create without org gets the scoped org", async () => {
    await expect(asA(() => db.person.create({ data: { orgId: orgB, firstName: "Mal", lastName: "Ice", role: "staff" } }))).rejects.toThrow(OrgScopeError);
    const p = await asA(() => db.person.create({ data: { firstName: "New", lastName: "Hire", role: "staff" } as never }));
    expect(p.orgId).toBe(orgA);
  });
  it("a non-operator with no org in scope cannot query scoped models", async () => {
    await expect(withScope({ orgId: null, role: "verifier" }, () => db.person.findMany())).rejects.toThrow(OrgScopeError);
  });
  it("operators without an org run unscoped", async () => {
    const people = await withScope({ orgId: null, role: "operator" }, () => db.person.findMany({ where: { id: { in: [personA, personB] } } }));
    expect(people).toHaveLength(2);
  });
});

describe("credit ledger", () => {
  it("recordVerification debits exactly one credit and refuses a second charge for the same verification", async () => {
    const r = await asA(() =>
      recordVerification({ orgId: orgA, credentialId: credA, verifiedById: null, method: "auto_api", sourceUrl: "https://example.com", result: "active", expirationSeen: null, disciplineFlag: false, note: null, evidenceFileKey: null, statusBefore: null, expiresBefore: null })
    );
    expect(r.balanceAfter).toBe(239);
    await expect(dbRaw.creditLedger.create({ data: { orgId: orgA, delta: -1, reason: "verification", verificationId: r.verificationId, balanceAfter: 238 } })).rejects.toThrow();
    const rows = await dbRaw.creditLedger.findMany({ where: { orgId: orgA } });
    expect(checkLedger(rows).ok).toBe(true);
  });
  it("ledger rows cannot be updated or deleted", async () => {
    const row = await dbRaw.creditLedger.findFirstOrThrow({ where: { orgId: orgA } });
    await expect(dbRaw.creditLedger.update({ where: { id: row.id }, data: { delta: 0 } })).rejects.toThrow();
    await expect(dbRaw.creditLedger.delete({ where: { id: row.id } })).rejects.toThrow();
  });
  it("invariant holds for every org in the database", async () => {
    const orgs = await dbRaw.org.findMany({ select: { id: true, slug: true } });
    for (const o of orgs) {
      const rows = await dbRaw.creditLedger.findMany({ where: { orgId: o.id } });
      const check = checkLedger(rows);
      expect(check.ok, `${o.slug}: ${check.problem}`).toBe(true);
      const sum = rows.reduce((s, r) => s + r.delta, 0);
      const last = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];
      if (last) expect(sum, o.slug).toBe(last.balanceAfter);
    }
  });
});
