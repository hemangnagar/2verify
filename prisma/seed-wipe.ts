/**
 * Removes every demo organization and its files so real customers can be onboarded into a clean
 * platform. Keeps: plans, credential types, board lookups, the operator user, and non-demo orgs.
 *
 * Insert-only tables (verification, audit_log, credit_ledger) are cleared for demo orgs inside one
 * transaction that sets `app.allow_wipe = 'on'`, the only thing the DB trigger accepts a DELETE under.
 * Everything else cascades from the org row.
 *
 * Refuses to run without CONFIRM_WIPE=yes.
 */
import "dotenv/config";
import { dbRaw } from "../src/lib/db";
import { storage } from "../src/lib/storage";

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error("Refusing to wipe. Re-run with CONFIRM_WIPE=yes (make seed-wipe CONFIRM_WIPE=yes).");
    process.exit(2);
  }
  const orgs = await dbRaw.org.findMany({ where: { isDemo: true }, select: { id: true, slug: true } });
  if (!orgs.length) {
    console.log("No demo organizations found.");
    return;
  }
  const ids = orgs.map((o) => o.id);
  const result = await dbRaw.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_wipe = 'on'`);
    const l = await tx.creditLedger.deleteMany({ where: { orgId: { in: ids } } });
    const v = await tx.verification.deleteMany({ where: { orgId: { in: ids } } });
    const a = await tx.auditLog.deleteMany({ where: { OR: [{ orgId: { in: ids } }, { user: { orgId: { in: ids } } }] } });
    const o = await tx.org.deleteMany({ where: { id: { in: ids } } }); // cascades entities, people, credentials, alerts, runs, matches, users
    return { ledgerRows: l.count, verifications: v.count, auditRows: a.count, orgs: o.count };
  });
  let files = 0;
  for (const id of ids) files += await storage().deletePrefix(`${id}/`);
  console.table({ ...result, files });
  console.log(`Removed demo orgs: ${orgs.map((o) => o.slug).join(", ")}. Plans, catalog, board lookups, and the operator user were kept.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => dbRaw.$disconnect());
