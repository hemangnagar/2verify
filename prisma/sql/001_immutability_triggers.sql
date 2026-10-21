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
