/**
 * Nightly job: recompute statuses, rebuild the verification queue, send alerts.
 *   npx tsx jobs/nightly.ts [--today YYYY-MM-DD]
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { runNightly } from "../src/lib/nightly";

const i = process.argv.indexOf("--today");
const today = i >= 0 ? new Date(process.argv[i + 1] + "T12:00:00Z") : new Date();

runNightly(today)
  .then((r) => console.log(`[nightly] ${today.toISOString().slice(0, 10)}:`, r))
  .catch((e) => {
    console.error("[nightly] failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
