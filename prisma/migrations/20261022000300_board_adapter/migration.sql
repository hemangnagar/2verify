-- Automated board adapters (Prompt B) and the per-credential record of the last automated attempt.
CREATE TABLE "board_adapter" (
  "id" TEXT NOT NULL,
  "state" CHAR(2) NOT NULL,
  "credential_type_id" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "min_interval_sec" INTEGER NOT NULL DEFAULT 5,
  "last_success_at" TIMESTAMP(3),
  "last_error" TEXT,
  "last_error_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "board_adapter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "board_adapter_state_credential_type_id_key" ON "board_adapter"("state", "credential_type_id");
ALTER TABLE "board_adapter" ADD CONSTRAINT "board_adapter_credential_type_id_fkey" FOREIGN KEY ("credential_type_id") REFERENCES "credential_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credential" ADD COLUMN "last_auto_attempt_at" TIMESTAMP(3);
ALTER TABLE "credential" ADD COLUMN "last_auto_error" TEXT;
