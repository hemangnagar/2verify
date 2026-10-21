-- Jurisdiction history per org. Backfilled from subscribed_states as of the term start.
CREATE TABLE "org_jurisdiction" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "state" CHAR(2) NOT NULL,
  "added_on" DATE NOT NULL,
  "removed_on" DATE,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_jurisdiction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "org_jurisdiction_org_id_state_key" ON "org_jurisdiction"("org_id", "state");
ALTER TABLE "org_jurisdiction" ADD CONSTRAINT "org_jurisdiction_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "org_jurisdiction" ("id", "org_id", "state", "added_on", "note")
SELECT 'oj_' || o."id" || '_' || s, o."id", s, o."term_starts_on", 'Backfilled from subscribed states'
FROM "org" o, unnest(o."subscribed_states") AS s;
