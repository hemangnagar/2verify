/**
 * Idempotent base seed: credential type catalog, board lookups for the demo states,
 * and the admin user from env. Safe to re-run; it upserts by natural key and never
 * touches demo rows. `make seed`.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { BOARD_ADAPTERS, BOARD_LOOKUPS, CREDENTIAL_TYPES, PLANS } from "./seed-lib/catalog";
import { asSystem } from "../src/lib/db";

async function main() {
  for (const t of CREDENTIAL_TYPES) {
    await db.credentialType.upsert({
      where: { name: t.name },
      create: { ...t, psvRequired: t.psvRequired ?? true, requiredForRoles: t.requiredForRoles ?? [] },
      update: { category: t.category, stateSpecific: t.stateSpecific, psvRequired: t.psvRequired ?? true, requiredForRoles: t.requiredForRoles ?? [] },
    });
  }
  const types = new Map((await db.credentialType.findMany()).map((t) => [t.name, t.id]));

  for (const b of BOARD_LOOKUPS) {
    const credentialTypeId = types.get(b.typeName)!;
    await db.boardLookup.upsert({
      where: { state_credentialTypeId: { state: b.state, credentialTypeId } },
      create: { state: b.state, credentialTypeId, boardName: b.boardName, urlTemplate: b.urlTemplate, notes: b.notes },
      update: { boardName: b.boardName, urlTemplate: b.urlTemplate, notes: b.notes },
    });
  }

  for (const a of BOARD_ADAPTERS) {
    const credentialTypeId = types.get(a.typeName)!;
    await db.boardAdapter.upsert({
      where: { state_credentialTypeId: { state: a.state, credentialTypeId } },
      create: { state: a.state, credentialTypeId, adapter: a.adapter, notes: a.notes },
      update: { adapter: a.adapter, notes: a.notes },
    });
  }

  for (const p of PLANS) {
    await db.plan.upsert({ where: { name: p.name }, create: p, update: { annualPriceCents: p.annualPriceCents, creditsPerYear: p.creditsPerYear, overageCents: p.overageCents, sortOrder: p.sortOrder } });
  }

  const email = (process.env.SEED_OPERATOR_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_OPERATOR_PASSWORD;
  if (email && password) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.user.upsert({
      where: { email },
      create: { email, name: process.env.SEED_OPERATOR_NAME ?? "2Verify Operator", role: "operator", orgId: null, passwordHash },
      update: { role: "operator", orgId: null, active: true },
    });
    console.log(`operator user: ${email}`);
  } else {
    console.log("SEED_OPERATOR_EMAIL / SEED_OPERATOR_PASSWORD not set; no operator user created");
  }

  console.log(`credential types: ${types.size}, board lookups: ${BOARD_LOOKUPS.length}, board adapters: ${BOARD_ADAPTERS.length}`);
}

asSystem(main)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
