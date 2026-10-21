-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'verifier');

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('pharmacist', 'technician', 'intern', 'prescriber', 'staff');

-- CreateEnum
CREATE TYPE "CredentialCategory" AS ENUM ('license', 'registration', 'certification', 'permit', 'insurance', 'contract', 'accreditation', 'training');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('person', 'entity');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('active', 'expiring', 'expired', 'suspended', 'unknown');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('auto_api', 'manual_board');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('active', 'expired', 'suspended', 'not_found', 'mismatch');

-- CreateEnum
CREATE TYPE "ScreeningSource" AS ENUM ('oig_leie', 'sam');

-- CreateEnum
CREATE TYPE "MatchDisposition" AS ENUM ('pending', 'false_positive', 'confirmed');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('lead_90', 'lead_60', 'lead_30', 'lead_7', 'overdue', 'verify_due', 'status_change');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'verifier',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npi" TEXT,
    "dea_number" TEXT,
    "state" CHAR(2) NOT NULL,
    "address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "role" "PersonRole" NOT NULL,
    "dob" DATE,
    "npi" TEXT,
    "hire_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_type" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CredentialCategory" NOT NULL,
    "default_lead_days" INTEGER NOT NULL DEFAULT 90,
    "default_reverify_days" INTEGER NOT NULL DEFAULT 365,
    "required_for_roles" "PersonRole"[] DEFAULT ARRAY[]::"PersonRole"[],
    "state_specific" BOOLEAN NOT NULL DEFAULT true,
    "psv_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_lookup" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "credential_type_id" TEXT NOT NULL,
    "board_name" TEXT NOT NULL,
    "url_template" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_lookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential" (
    "id" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "person_id" TEXT,
    "entity_id" TEXT,
    "credential_type_id" TEXT NOT NULL,
    "state" CHAR(2),
    "number" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "renewal_lead_days" INTEGER NOT NULL,
    "reverify_days" INTEGER NOT NULL,
    "next_verify_due" DATE,
    "status" "CredentialStatus" NOT NULL DEFAULT 'unknown',
    "document_file_key" TEXT,
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "VerificationMethod" NOT NULL,
    "source_url" TEXT NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "expiration_seen" DATE,
    "discipline_flag" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "evidence_file_key" TEXT,
    "status_before" "CredentialStatus",
    "expires_before" DATE,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_run" (
    "id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ScreeningSource" NOT NULL,
    "source_version" TEXT NOT NULL,
    "persons_screened" INTEGER NOT NULL,
    "matches_found" INTEGER NOT NULL,
    "report_file_key" TEXT,
    "roster" JSONB NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "screening_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_match" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "source_record" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matched_on" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "disposition" "MatchDisposition" NOT NULL DEFAULT 'pending',
    "review_note" TEXT,

    CONSTRAINT "screening_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "AlertKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "table" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "entity_npi_key" ON "entity"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "entity_dea_number_key" ON "entity"("dea_number");

-- CreateIndex
CREATE UNIQUE INDEX "person_email_key" ON "person"("email");

-- CreateIndex
CREATE UNIQUE INDEX "person_npi_key" ON "person"("npi");

-- CreateIndex
CREATE INDEX "person_last_name_first_name_idx" ON "person"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "credential_type_name_key" ON "credential_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "board_lookup_state_credential_type_id_key" ON "board_lookup"("state", "credential_type_id");

-- CreateIndex
CREATE INDEX "credential_expires_on_idx" ON "credential"("expires_on");

-- CreateIndex
CREATE INDEX "credential_next_verify_due_idx" ON "credential"("next_verify_due");

-- CreateIndex
CREATE INDEX "credential_status_idx" ON "credential"("status");

-- CreateIndex
CREATE INDEX "credential_person_id_idx" ON "credential"("person_id");

-- CreateIndex
CREATE INDEX "credential_entity_id_idx" ON "credential"("entity_id");

-- CreateIndex
CREATE INDEX "verification_credential_id_verified_at_idx" ON "verification"("credential_id", "verified_at");

-- CreateIndex
CREATE INDEX "screening_run_source_run_at_idx" ON "screening_run"("source", "run_at");

-- CreateIndex
CREATE INDEX "screening_match_disposition_idx" ON "screening_match"("disposition");

-- CreateIndex
CREATE INDEX "alert_credential_id_kind_idx" ON "alert"("credential_id", "kind");

-- CreateIndex
CREATE INDEX "audit_log_table_row_id_idx" ON "audit_log"("table", "row_id");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_lookup" ADD CONSTRAINT "board_lookup_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "credential_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "credential_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification" ADD CONSTRAINT "verification_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification" ADD CONSTRAINT "verification_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_match" ADD CONSTRAINT "screening_match_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "screening_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_match" ADD CONSTRAINT "screening_match_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_match" ADD CONSTRAINT "screening_match_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- hand-written constraints and triggers (see prisma/sql/001_immutability_triggers.sql) ----
-- Appended to the initial Prisma migration (prisma migrate dev --create-only, then paste).
-- Prisma cannot express CHECK constraints or triggers, so they live here.

-- 1. Credential subject: exactly one of person_id / entity_id, matching subject_type.
ALTER TABLE "credential"
  ADD CONSTRAINT credential_subject_exactly_one CHECK (
    (subject_type = 'person' AND person_id IS NOT NULL AND entity_id IS NULL) OR
    (subject_type = 'entity' AND entity_id IS NOT NULL AND person_id IS NULL)
  );

-- 2. Insert-only tables. UPDATE and DELETE are rejected unless the session has
--    explicitly opted in for a seed wipe (SET LOCAL app.allow_wipe = 'on'),
--    which only `make seed-wipe` / `make demo-reset` do, inside one transaction.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_wipe', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: table is insert-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER verification_insert_only
  BEFORE UPDATE OR DELETE ON "verification"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER audit_log_insert_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 3. Only one primary entity.
CREATE UNIQUE INDEX entity_single_primary ON "entity" (is_primary) WHERE is_primary = true;
