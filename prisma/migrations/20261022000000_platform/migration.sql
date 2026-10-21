-- Phase 1: multi-tenant platform. Hand-written so existing rows survive.
-- Order: enums → plan → org (one org for existing data) → org_id on domain tables → per-org
-- uniqueness → users → credit ledger with a reconciled history.

-- 1. Enums -----------------------------------------------------------------
CREATE TYPE "OrgStatus" AS ENUM ('trial', 'active', 'suspended');
CREATE TYPE "CreditReason" AS ENUM ('allotment', 'verification', 'adjustment', 'overage');
ALTER TYPE "VerificationMethod" ADD VALUE 'auto_board';

-- user.role: admin → org_admin, verifier unchanged, operator new
CREATE TYPE "UserRole_new" AS ENUM ('operator', 'org_admin', 'verifier');
ALTER TABLE "user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "role" TYPE "UserRole_new"
  USING (CASE "role"::text WHEN 'admin' THEN 'org_admin' ELSE "role"::text END)::"UserRole_new";
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'verifier';

-- 2. Plans ------------------------------------------------------------------
CREATE TABLE "plan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "annual_price_cents" INTEGER NOT NULL,
  "credits_per_year" INTEGER NOT NULL,
  "overage_cents" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_name_key" ON "plan"("name");
INSERT INTO "plan" ("id", "name", "annual_price_cents", "credits_per_year", "overage_cents", "sort_order") VALUES
  ('plan_track',      'Track',      0,       0,    600, 1),
  ('plan_core',       'Core',       120000,  240,  500, 2),
  ('plan_team',       'Team',       555000,  1200, 462, 3),
  ('plan_advanced',   'Advanced',   1020000, 2400, 425, 4),
  ('plan_enterprise', 'Enterprise', 1395000, 3600, 388, 5);

-- 3. Org --------------------------------------------------------------------
CREATE TABLE "org" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "status" "OrgStatus" NOT NULL DEFAULT 'trial',
  "subscribed_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "term_starts_on" DATE NOT NULL,
  "is_demo" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "org_slug_key" ON "org"("slug");
ALTER TABLE "org" ADD CONSTRAINT "org_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One org for whatever data already exists (name from the primary entity).
INSERT INTO "org" ("id", "name", "slug", "plan_id", "status", "subscribed_states", "term_starts_on", "is_demo", "created_at", "updated_at")
SELECT
  'org_migrated',
  COALESCE((SELECT "name" FROM "entity" WHERE "is_primary" LIMIT 1), 'Default Organization'),
  COALESCE(trim(both '-' from lower(regexp_replace((SELECT "name" FROM "entity" WHERE "is_primary" LIMIT 1), '[^A-Za-z0-9]+', '-', 'g'))), 'default'),
  'plan_advanced',
  'active',
  COALESCE(ARRAY(SELECT DISTINCT "state" FROM "credential" WHERE "state" IS NOT NULL ORDER BY "state"), ARRAY[]::TEXT[]),
  (date_trunc('month', CURRENT_DATE) - INTERVAL '11 months')::date,
  EXISTS (SELECT 1 FROM "entity" WHERE "is_demo"),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "entity") OR EXISTS (SELECT 1 FROM "user");

-- 4. org_id on domain tables --------------------------------------------------
ALTER TABLE "entity"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "person"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "credential"      ADD COLUMN "org_id" TEXT;
ALTER TABLE "verification"    ADD COLUMN "org_id" TEXT;
ALTER TABLE "screening_run"   ADD COLUMN "org_id" TEXT;
ALTER TABLE "screening_match" ADD COLUMN "org_id" TEXT;
ALTER TABLE "alert"           ADD COLUMN "org_id" TEXT;
ALTER TABLE "audit_log"       ADD COLUMN "org_id" TEXT;
ALTER TABLE "user"            ADD COLUMN "org_id" TEXT;

-- The insert-only triggers block the backfill UPDATE; disable them for this step only.
ALTER TABLE "verification" DISABLE TRIGGER verification_insert_only;
ALTER TABLE "audit_log"    DISABLE TRIGGER audit_log_insert_only;
UPDATE "entity"          SET "org_id" = 'org_migrated';
UPDATE "person"          SET "org_id" = 'org_migrated';
UPDATE "credential"      SET "org_id" = 'org_migrated';
UPDATE "verification"    SET "org_id" = 'org_migrated';
UPDATE "screening_run"   SET "org_id" = 'org_migrated';
UPDATE "screening_match" SET "org_id" = 'org_migrated';
UPDATE "alert"           SET "org_id" = 'org_migrated';
UPDATE "audit_log"       SET "org_id" = 'org_migrated';
UPDATE "user"            SET "org_id" = 'org_migrated';
ALTER TABLE "verification" ENABLE TRIGGER verification_insert_only;
ALTER TABLE "audit_log"    ENABLE TRIGGER audit_log_insert_only;

ALTER TABLE "entity"          ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "person"          ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "credential"      ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "verification"    ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "screening_run"   ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "screening_match" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "alert"           ALTER COLUMN "org_id" SET NOT NULL;

ALTER TABLE "entity"          ADD CONSTRAINT "entity_org_id_fkey"          FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "person"          ADD CONSTRAINT "person_org_id_fkey"          FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credential"      ADD CONSTRAINT "credential_org_id_fkey"      FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification"    ADD CONSTRAINT "verification_org_id_fkey"    FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screening_run"   ADD CONSTRAINT "screening_run_org_id_fkey"   FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screening_match" ADD CONSTRAINT "screening_match_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alert"           ADD CONSTRAINT "alert_org_id_fkey"           FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_log"       ADD CONSTRAINT "audit_log_org_id_fkey"       FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user"            ADD CONSTRAINT "user_org_id_fkey"            FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Indexes: hot paths become (org_id, …); uniqueness becomes per-org --------
DROP INDEX "entity_npi_key";
DROP INDEX "entity_dea_number_key";
DROP INDEX "person_email_key";
DROP INDEX "person_npi_key";
DROP INDEX "person_last_name_first_name_idx";
DROP INDEX "credential_expires_on_idx";
DROP INDEX "credential_next_verify_due_idx";
DROP INDEX "credential_status_idx";
DROP INDEX "screening_run_source_run_at_idx";
DROP INDEX "screening_match_disposition_idx";
DROP INDEX "audit_log_at_idx";

CREATE UNIQUE INDEX "entity_org_id_npi_key"        ON "entity"("org_id", "npi");
CREATE UNIQUE INDEX "entity_org_id_dea_number_key" ON "entity"("org_id", "dea_number");
CREATE INDEX        "entity_org_id_idx"            ON "entity"("org_id");
CREATE UNIQUE INDEX "person_org_id_email_key"      ON "person"("org_id", "email");
CREATE UNIQUE INDEX "person_org_id_npi_key"        ON "person"("org_id", "npi");
CREATE INDEX "person_org_id_last_name_first_name_idx" ON "person"("org_id", "last_name", "first_name");
CREATE INDEX "credential_org_id_expires_on_idx"      ON "credential"("org_id", "expires_on");
CREATE INDEX "credential_org_id_next_verify_due_idx" ON "credential"("org_id", "next_verify_due");
CREATE INDEX "credential_org_id_status_idx"          ON "credential"("org_id", "status");
CREATE INDEX "verification_org_id_verified_at_idx"   ON "verification"("org_id", "verified_at");
CREATE INDEX "screening_run_org_id_source_run_at_idx" ON "screening_run"("org_id", "source", "run_at");
CREATE INDEX "screening_match_org_id_disposition_idx" ON "screening_match"("org_id", "disposition");
CREATE INDEX "alert_org_id_idx"                      ON "alert"("org_id");
CREATE INDEX "audit_log_org_id_at_idx"               ON "audit_log"("org_id", "at");
CREATE INDEX "user_org_id_idx"                       ON "user"("org_id");

-- 6. Credit ledger (insert-only) ----------------------------------------------
CREATE TABLE "credit_ledger" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" "CreditReason" NOT NULL,
  "verification_id" TEXT,
  "balance_after" INTEGER NOT NULL,
  "note" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "credit_ledger_verification_id_key" ON "credit_ledger"("verification_id");
CREATE INDEX "credit_ledger_org_id_created_at_idx" ON "credit_ledger"("org_id", "created_at");
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_fkey"          FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "verification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_fkey"      FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER credit_ledger_insert_only
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Reconciled history for the migrated org: the plan allotment at term start, then one debit per
-- existing verification in time order, so sum(delta) == balance_after of the newest row.
INSERT INTO "credit_ledger" ("id", "org_id", "delta", "reason", "verification_id", "balance_after", "note", "created_at")
SELECT 'cl_allot_' || o."id", o."id", p."credits_per_year", 'allotment', NULL, p."credits_per_year",
       'Annual allotment (' || p."name" || ') — migrated', o."term_starts_on"
FROM "org" o JOIN "plan" p ON p."id" = o."plan_id";

INSERT INTO "credit_ledger" ("id", "org_id", "delta", "reason", "verification_id", "balance_after", "note", "created_at")
SELECT 'cl_v_' || v."id", v."org_id", -1, 'verification', v."id",
       p."credits_per_year" - row_number() OVER (PARTITION BY v."org_id" ORDER BY v."verified_at", v."id"),
       NULL, v."verified_at"
FROM "verification" v JOIN "org" o ON o."id" = v."org_id" JOIN "plan" p ON p."id" = o."plan_id";
