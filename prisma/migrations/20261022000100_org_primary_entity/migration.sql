-- One primary entity per organization, not per database.
DROP INDEX IF EXISTS entity_single_primary;
CREATE UNIQUE INDEX entity_org_single_primary ON "entity" ("org_id") WHERE is_primary = true;
