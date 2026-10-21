/**
 * Idempotent base seed: credential type catalog, board lookups for the demo states,
 * and the admin user from env. Safe to re-run; it upserts by natural key and never
 * touches demo rows. `make seed`.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { BOARD_LOOKUPS, CREDENTIAL_TYPES } from "./seed-lib/catalog";

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

  const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.user.upsert({
      where: { email },
      create: { email, name: process.env.SEED_ADMIN_NAME ?? "Admin", role: "admin", passwordHash },
      update: { role: "admin", active: true },
    });
    console.log(`admin user: ${email}`);
  } else {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; no admin user created");
  }

  console.log(`credential types: ${types.size}, board lookups: ${BOARD_LOOKUPS.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
