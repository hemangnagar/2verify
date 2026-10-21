/**
 * Monthly exclusion screening. Cron: 1st of the month, once per source.
 *   npx tsx jobs/screening.ts --source oig_leie
 *   npx tsx jobs/screening.ts --source sam
 * Mode comes from SCREENING_MODE (live | fixture); --mode overrides.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { runScreening, type ScreeningMode } from "../src/lib/screening";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const source = get("--source");
const mode = get("--mode") as ScreeningMode | undefined;
if (source !== "oig_leie" && source !== "sam") {
  console.error("usage: jobs/screening.ts --source oig_leie|sam [--mode live|fixture]");
  process.exit(2);
}

runScreening(source, { mode })
  .then((r) => console.log(`[screening] ${source}: ${r.screened} screened, ${r.matches} match(es), run ${r.runId}, mode ${r.mode}`))
  .catch((e) => {
    console.error("[screening] failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
