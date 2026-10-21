# Pharmacy Compliance Tracker

Single-tenant credential tracking and primary source verification (PSV) for a small pharmacy
group: licenses, permits, registrations, insurance, training, monthly OIG/SAM exclusion
screening, and audit-ready evidence for URAC/ACHC surveys. Replaces a spreadsheet. No patient data.

Status: **Phase 0, session one** — schema, migration, auth, storage, audited data layer, and the
"Sierra Specialty Pharmacy" demo seed. Pages beyond login and the dashboard tiles land in session two.
See `docs/PLAN.md` for the full page list and build order.

## Quickstart (Docker)

```bash
cp .env.example .env            # edit SESSION_SECRET and SEED_ADMIN_PASSWORD
make dev                        # app :3000, Postgres :5432, MinIO :9000/:9001, Mailpit :8025, cron
make demo                       # in another shell: catalog + admin user + Sierra demo data
```

Sign in at http://localhost:3000 as `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, or as the demo
verifier `verifier@sierra-rx.example.com` / `verifier1234`.

## Quickstart (no Docker)

Needs Node 22 and a Postgres 16 you can reach.

```bash
cp .env.example .env
# set DATABASE_URL, set STORAGE_DRIVER=local (files go under ./data/files)
npm install                     # also runs prisma generate
make demo                       # migrate → catalog → demo
npm run dev
```

## Make targets

| Target | What it does |
|---|---|
| `make dev` / `make down` | Compose up / down |
| `make migrate` | `prisma migrate deploy` |
| `make seed` | Credential type catalog, board lookup URLs, admin user from env. Idempotent. |
| `make demo` | `seed` + load the Sierra demo (2 locations, 17 people, 68 credentials, evidence files, last month's screening runs). Refuses if demo data already exists. |
| `make demo-reset` | Wipe demo rows and files, then `make demo`. |
| `make seed-wipe` | Remove all demo rows and files before importing real data. Needs `CONFIRM_WIPE=yes`. Keeps catalog, board lookups, env admin, and audit rows for non-demo data. |
| `make test` | Vitest: status computation, alert schedule, exclusion matching, identifier check digits. |
| `make e2e` | Playwright smoke against a running app (`E2E_BASE_URL`, default localhost:3000; `PW_CHROMIUM_PATH` to use a preinstalled browser). |
| `make nightly` / `make screening` | Run the cron jobs by hand (session two). |
| `make lint` / `make typecheck` | ESLint / `tsc --noEmit` |

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@localhost:5432/compliance` |
| `APP_URL` | Public base URL (used in emails and local signed URLs) | `http://localhost:3000` |
| `SESSION_SECRET` | Signs the session cookie and local file URLs. 32+ random chars. | — (required) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` | Admin user created by `make seed` | demo values |
| `ALERT_CC` | Comma-separated addresses that receive every alert (the compliance lead) | `compliance@sierra-rx.example.com` |
| `STORAGE_DRIVER` | `s3` or `local` | `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | S3-compatible storage (MinIO, R2, S3). Bucket must be private. | MinIO defaults |
| `SIGNED_URL_TTL_SECONDS` | Lifetime of file links | `600` |
| `LOCAL_STORAGE_DIR` | Where `local` storage writes | `./data/files` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | Outbound email | Mailpit |
| `SAM_API_KEY` | SAM.gov Exclusions API key (Phase 2) | — |

## How the pieces fit

- **`prisma/schema.prisma`** — 11 tables. `verification` and `audit_log` are insert-only, enforced by
  Postgres triggers in the init migration (`prisma/sql/001_immutability_triggers.sql` is the source).
  The only exception is a `DELETE` inside a transaction that sets `app.allow_wipe = 'on'`, which only
  `seed-wipe` does.
- **`src/lib/db.ts`** — Prisma client with an audit extension: every create/update/delete on every
  model writes an `audit_log` row with before/after snapshots and the acting user
  (`auditContext.run({ userId }, …)` in server actions; null = system job). The audit row is written
  with the base client, so if a surrounding interactive transaction rolls back, the audit row stays
  and records the attempt.
- **`src/lib/storage.ts`** — S3 or local driver, keys `{entity_id}/{table}/{row_id}/{timestamp}-{filename}`,
  signed URLs via `/api/files/...`. Evidence metadata (verifier, timestamp, source URL) is stamped on
  the object.
- **`src/lib/status.ts`** — credential status, next-verify-due, and which lead alerts (90/60/30/7,
  overdue) are due. Used by the dashboard, the nightly job, and the seed.
- **`src/lib/matching.ts`** — OIG LEIE / SAM matching: exact NPI → exact name+DOB → Jaro-Winkler
  name match. A differing DOB rules a record out; a name-only match with no DOB is capped at 0.9 and
  flagged for review at ≥ 0.8.
- **`prisma/seed-demo.ts`** — the demo. Dates are relative to the run date, so the story holds
  whenever it is shown: 2 expiring ≤30 days, 3 more ≤90, 1 technician license 12 days overdue with
  a full 90/60/30/7/overdue alert history, 1 new-hire pharmacist never verified, one renewal caught
  by re-verification (status_change alert), two screening runs for last month with one pending SAM
  fuzzy match on a prescriber. Fixture extracts live in `prisma/fixtures/`.

## Monthly runbook (to be completed in session two)

1. Cron runs `jobs/screening.ts` for `oig_leie` and `sam` on the 1st; reports are stored even with zero matches.
2. Admin opens Screening → pending matches, reviews each against the source record, sets a disposition.
3. Nightly `jobs/nightly.ts` recomputes statuses and sends lead/overdue alerts; the verify queue lists
   anything due within 30 days.
4. Before a survey: Reports → Survey pack (PDF per location + evidence ZIP).

## Security notes

Employee PII (name, DOB for screening, license numbers) is held; no PHI. Encrypt the Postgres volume
at rest, serve over TLS, keep the evidence bucket private (signed URLs only), and rotate
`SESSION_SECRET` if it leaks (this signs out everyone and invalidates local file links).
