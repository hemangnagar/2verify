/**
 * Integration test (dev database): a board result flows through applyBoardResult into an
 * auto_board verification, a one-credit debit, a corrected expiry, and a status_change alert.
 * The live adapter itself is covered by the RUN_LIVE_BOARD smoke test in tx.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { db, dbRaw, withScope } from "../db";
import { applyBoardResult } from "./index";

const stamp = Date.now().toString(36);
let orgId: string, credId: string, entityId: string;

beforeAll(async () => {
  process.env.STORAGE_DRIVER = "local";
  process.env.MAIL_DRIVER = "log";
  const plan = await dbRaw.plan.findUniqueOrThrow({ where: { name: "Team" } });
  const type = await dbRaw.credentialType.findUniqueOrThrow({ where: { name: "Pharmacy Permit" } });
  const org = await dbRaw.org.create({ data: { name: `Adapter test ${stamp}`, slug: `adapter-${stamp}`, planId: plan.id, status: "active", subscribedStates: ["TX"], termStartsOn: new Date(), isDemo: true } });
  orgId = org.id;
  await dbRaw.creditLedger.create({ data: { orgId, delta: 1200, reason: "allotment", balanceAfter: 1200 } });
  await dbRaw.user.create({ data: { orgId, email: `admin-${stamp}@example.com`, name: "Admin", role: "org_admin", passwordHash: "x" } });
  const entity = await dbRaw.entity.create({ data: { orgId, name: "Test Pharmacy", state: "TX", address: "1 Main St", isPrimary: true } });
  entityId = entity.id;
  const cred = await dbRaw.credential.create({
    data: { orgId, subjectType: "entity", entityId, credentialTypeId: type.id, state: "TX", number: "33978", expiresOn: new Date("2027-01-31T00:00:00Z"), renewalLeadDays: 90, reverifyDays: 365, status: "active" },
  });
  credId = cred.id;
});

afterAll(async () => {
  await dbRaw.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_wipe = 'on'`);
    await tx.creditLedger.deleteMany({ where: { orgId } });
    await tx.verification.deleteMany({ where: { orgId } });
    await tx.auditLog.deleteMany({ where: { orgId } });
    await tx.org.deleteMany({ where: { id: orgId } });
  });
  await dbRaw.$disconnect();
});

function png(): Buffer {
  const p = new PNG({ width: 20, height: 20 });
  p.data.fill(200);
  return PNG.sync.write(p);
}

describe("applyBoardResult", () => {
  it("writes an auto_board verification, debits one credit, corrects the expiry, and alerts", async () => {
    const fetchedAt = new Date();
    const outcome = await withScope({ orgId, role: "system" }, async () => {
      const c = await db.credential.findUniqueOrThrow({ where: { id: credId }, include: { credentialType: true, person: true, entity: true } });
      return applyBoardResult(
        c,
        { status: "active", expirationSeen: new Date("2028-01-31T00:00:00Z"), disciplineFlag: false, holderName: "CVS PHARMACY #11306", statusText: "Active", rawText: "License Status Active", sourceUrl: "https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp?id=33978&type=1", screenshotPng: png(), fetchedAt },
        { adapterKey: "tx-pharmacy-permit", adapterRowId: null, actorUserId: null, attemptAt: fetchedAt }
      );
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.changed).toBe(true);

    const v = await dbRaw.verification.findUniqueOrThrow({ where: { id: outcome.verificationId } });
    expect(v.method).toBe("auto_board");
    expect(v.result).toBe("active");
    expect(v.evidenceFileKey).toMatch(new RegExp(`^${orgId}/${entityId}/verification/`));
    expect(v.expiresBefore?.toISOString().slice(0, 10)).toBe("2027-01-31");

    const ledger = await dbRaw.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ delta: -1, reason: "verification", verificationId: v.id, balanceAfter: 1199 });

    const c = await dbRaw.credential.findUniqueOrThrow({ where: { id: credId } });
    expect(c.expiresOn?.toISOString().slice(0, 10)).toBe("2028-01-31");
    expect(c.lastAutoError).toBeNull();
    expect(c.nextVerifyDue?.getFullYear()).toBe(fetchedAt.getFullYear() + 1);

    const alerts = await dbRaw.alert.findMany({ where: { credentialId: credId } });
    expect(alerts.some((a) => a.kind === "status_change")).toBe(true);
  });
});
