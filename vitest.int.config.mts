import { defineConfig } from "vitest/config";
import path from "node:path";

/** Integration tests: need DATABASE_URL (loaded from .env) and a migrated database. */
export default defineConfig({
  test: { include: ["src/**/*.int.test.ts"], environment: "node", setupFiles: ["dotenv/config"], fileParallelism: false, testTimeout: 30_000 },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
