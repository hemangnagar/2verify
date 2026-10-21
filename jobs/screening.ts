/**
 * Monthly exclusion screening. Cron: 1st of the month, once per source.
 *   npx tsx jobs/screening.ts --source oig_leie
 *   npx tsx jobs/screening.ts --source sam
 * Mode comes from SCREENING_MODE (live | fixture); --mode overrides.
 */
import "dotenv/config";
import { asOrg, asSystem, db } from "../src/lib/db";
import { runScreening, type ScreeningMode } from "../src/lib/screening";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const source = get("--source");
const mode = get("--mode") as ScreeningMode | undefined;
const onlyOrg = get("--org"); // slug
if (source !== "oig_leie" && source !== "sam") {
  console.error("usage: jobs/screening.ts --source oig_leie|sam [--mode live|fixture] [--org slug]");
  process.exit(2);
}

(async () => {
  const orgs = await asSystem(() => db.org.findMany({ where: { status: { not: "suspended" }, ...(onlyOrg ? { slug: onlyOrg } : {}) }, orderBy: { name: "asc" } }));
  for (const org of orgs) {
    const r = await asOrg(org.id, () => runScreening(source, { mode }));
    console.log(`[screening] ${org.slug} ${source}: ${r.screened} screened, ${r.matches} match(es), run ${r.runId}, mode ${r.mode}`);
  }
})()
  .catch((e) => {
    console.error("[screening] failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
