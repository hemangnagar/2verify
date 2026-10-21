/**
 * Removes every demo row and file so real data can be imported into a clean system.
 * Keeps: credential types, board lookups, the env admin user, and audit rows for non-demo data.
 *
 * Insert-only tables (verification, audit_log) are cleared for demo rows inside one transaction
 * that sets `app.allow_wipe = 'on'`, the only thing the DB trigger accepts a DELETE under.
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

  const entities = await dbRaw.entity.findMany({ where: { isDemo: true }, select: { id: true } });
  const people = await dbRaw.person.findMany({ where: { isDemo: true }, select: { id: true } });
  const credentials = await dbRaw.credential.findMany({ where: { isDemo: true }, select: { id: true } });
  const runs = await dbRaw.screeningRun.findMany({ where: { isDemo: true }, select: { id: true } });
  const credIds = credentials.map((c) => c.id);
  const runIds = runs.map((r) => r.id);
  const verifications = await dbRaw.verification.findMany({ where: { credentialId: { in: credIds } }, select: { id: true } });
  const matches = await dbRaw.screeningMatch.findMany({ where: { runId: { in: runIds } }, select: { id: true } });
  const alerts = await dbRaw.alert.findMany({ where: { isDemo: true }, select: { id: true } });
  const demoUsers = await dbRaw.user.findMany({ where: { email: "verifier@sierra-rx.example.com" }, select: { id: true } });

  const allIds = [
    ...entities, ...people, ...credentials, ...runs, ...verifications, ...matches, ...alerts, ...demoUsers,
  ].map((r) => r.id);

  const result = await dbRaw.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_wipe = 'on'`);
    const v = await tx.verification.deleteMany({ where: { credentialId: { in: credIds } } });
    const a = await tx.alert.deleteMany({ where: { isDemo: true } });
    const m = await tx.screeningMatch.deleteMany({ where: { runId: { in: runIds } } });
    const r = await tx.screeningRun.deleteMany({ where: { isDemo: true } });
    const c = await tx.credential.deleteMany({ where: { isDemo: true } });
    const p = await tx.person.deleteMany({ where: { isDemo: true } });
    const e = await tx.entity.deleteMany({ where: { isDemo: true } });
    // Audit rows written by the demo verifier must go before the user row.
    const au = await tx.auditLog.deleteMany({ where: { OR: [{ rowId: { in: allIds } }, { userId: { in: demoUsers.map((u) => u.id) } }] } });
    const u = await tx.user.deleteMany({ where: { id: { in: demoUsers.map((u) => u.id) } } });
    return { verifications: v.count, alerts: a.count, matches: m.count, runs: r.count, credentials: c.count, people: p.count, entities: e.count, auditRows: au.count, users: u.count };
  });

  let files = 0;
  for (const e of entities) files += await storage().deletePrefix(`${e.id}/`);

  console.table({ ...result, files });
  console.log("Demo data removed. Catalog, board lookups, and the env admin user were kept.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => dbRaw.$disconnect());
