# 2Verify — Track. Verify. Stay Compliant.

Multi-tenant pharmacy credential tracking and primary source verification (PSV): licenses,
permits, registrations, insurance, training, monthly OIG/SAM exclusion screening, audit-ready
evidence for URAC/ACHC surveys, and the platform around it: customer organizations, plan tiers,
a credit ledger, and an operator console. No patient data.

Status: **Phase 1 founder POC (Prompt A) complete.** Three demo customer orgs on different tiers,
the operator console, usage and pricing per org at the one-pager numbers, one credit per
verification, org isolation enforced in the data layer and tested. Prompt B (the automated Texas
board adapter) is next. See `docs/phase1/PLAN.md` for the design and `docs/boards/` for the board
probe results.

## Quickstart (Docker)

```bash
cp .env.example .env            # edit SESSION_SECRET and SEED_ADMIN_PASSWORD
make dev                        # app :3000, Postgres :5432, MinIO :9000/:9001, Mailpit :8025, cron
make demo                       # in another shell: catalog + admin user + Sierra demo data
```

## Demo login matrix

| Who | Email | Password | Lands on |
|---|---|---|---|
| 2Verify operator | `SEED_OPERATOR_EMAIL` (default `ops@2verify.example.com`) | `SEED_OPERATOR_PASSWORD` | `/ops` — every customer; "Switch into org" to work as that org's admin with a banner |
| Sierra admin | `admin@sierra.example.com` | `SEED_ORG_ADMIN_PASSWORD` (default `admin1234`) | Sierra dashboard |
| Sierra verifier | `verifier@sierra-rx.example.com` | `verifier1234` | Sierra dashboard, queue and verify page; read-only elsewhere |
| Harbor admin | `admin@harbor.example.com` | `SEED_ORG_ADMIN_PASSWORD` | Harbor dashboard |
| Prairie admin | `admin@prairie.example.com` | `SEED_ORG_ADMIN_PASSWORD` | Prairie dashboard |

Demo orgs after `make demo`:

| Org | States | Plan | Status | Credits | What it shows |
|---|---|---|---|---|---|
| Sierra Specialty Pharmacy | NV, CA, AZ | Advanced | active | 2,400 allotted, 588 used, 1,812 left | the walkthrough: 2 / 3 / 1 / 1 dashboard, overdue technician, never-verified pharmacist, one pending SAM match |
| Harbor Compounding | CA | Core | active | 240 allotted, 201 used, 39 left | usage page projects overage at the current run rate; one overdue technician |
| Prairie Infusion Partners | TX, OK, KS, MO | Team | trial | 1,200 allotted, 40 used | a fresh trial: most credentials never verified, queue full |

## Quickstart (no Docker)

Needs Node 22 and a Postgres 16 you can reach.

```bash
cp .env.example .env
# set DATABASE_URL, set STORAGE_DRIVER=local (files go under ./data/files)
npm install                     # also runs prisma generate
make demo                       # migrate → catalog → demo
npm run dev
```

## Operator

Operators are 2Verify staff: `role = operator`, no org. They sign in to `/ops`:

- **Customers** — every org with plan, jurisdictions and fee, credit balance, verifications this
  month, credentials expiring in 30 days, open screening matches, status. "Switch into org" sets
  the active org in the session and shows an amber banner on every customer page until "Exit".
  Everything done while switched in is audited under the operator's user id and the org.
- **New customer** — name, slug, plan, jurisdictions, status, first admin. Creates the org, posts
  the plan's annual credit allotment to the ledger, creates the org_admin with a temporary
  password, and emails the invite (the password is also shown once on screen).
- **Org detail** — contract and usage summary, users, the credit ledger, "Post credits"
  (adjustment / overage pack / allotment, with a note), suspend / reactivate, renew term.

Customers never see the console. Org users are scoped by the data layer: every read on an
org-owned table is filtered to their org and every write carries it, whatever the page or action
does (`src/lib/db.ts`, tested in `src/lib/db.int.test.ts`).

### Pricing and credits

| Plan | Annual | Credits / year | Overage per credit |
|---|---|---|---|
| Track | $0 | 0 | $6.00 |
| Core | $1,200 | 240 | $5.00 |
| Team | $5,550 | 1,200 | $4.62 |
| Advanced | $10,200 | 2,400 | $4.25 |
| Enterprise | $13,950 | 3,600 | $3.88 |

Plus $400 per subscribed jurisdiction per year (max 51). One credit is debited for every
verification row, automated or manual, in the same transaction that inserts it. Exclusion
screening is free. The ledger is insert-only; the invariant `sum(delta) == balance_after of the
newest row` is checked by the seed and the integration tests. Balances may go negative; the usage
page prices the shortfall at the plan's overage rate.

## Make targets

| Target | What it does |
|---|---|
| `make dev` / `make down` | Compose up / down |
| `make migrate` | `prisma migrate deploy` |
| `make seed` | Plans, credential type catalog, board lookup URLs, operator user from env. Idempotent. |
| `make demo` | `seed` + load the three demo orgs with evidence files, alert history, reconciled ledgers, and last month's screening runs. Refuses if demo orgs already exist. |
| `make demo-reset` | Wipe demo orgs and files, then `make demo`. |
| `make seed-wipe` | Remove every demo org (rows, users, files) before onboarding real customers. Needs `CONFIRM_WIPE=yes`. Keeps plans, catalog, board lookups, the operator, and non-demo orgs. |
| `make test` | Vitest: status computation, alert schedule, exclusion matching, identifier check digits, pricing and usage math, ledger invariant. |
| `make test-int` | Integration tests against `DATABASE_URL`: cross-org reads and writes fail, ledger debits exactly once, invariant holds for every org. |
| `make e2e` | Playwright smoke against a running app (`E2E_BASE_URL`, default localhost:3000; `PW_CHROMIUM_PATH` to use a preinstalled browser). |
| `make nightly` / `make screening` | Run the cron jobs by hand (session two). |
| `make lint` / `make typecheck` | ESLint / `tsc --noEmit` |

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@localhost:5432/compliance` |
| `APP_URL` | Public base URL (used in emails and local signed URLs) | `http://localhost:3000` |
| `SESSION_SECRET` | Signs the session cookie and local file URLs. 32+ random chars. | — (required) |
| `SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_NAME` / `SEED_OPERATOR_PASSWORD` | Operator user created by `make seed` | demo values |
| `SEED_ORG_ADMIN_PASSWORD` | Password for the three demo org admins | `admin1234` |
| `ALERT_CC` | Comma-separated addresses that receive every alert (the compliance lead) | `compliance@sierra-rx.example.com` |
| `STORAGE_DRIVER` | `s3` or `local` | `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | S3-compatible storage (MinIO, R2, S3). Bucket must be private. | MinIO defaults |
| `SIGNED_URL_TTL_SECONDS` | Lifetime of file links | `600` |
| `LOCAL_STORAGE_DIR` | Where `local` storage writes | `./data/files` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | Outbound email | Mailpit |
| `SAM_API_KEY` | SAM.gov Exclusions API key (Phase 2) | — |

## How the pieces fit

- **`src/config/brand.ts`** — every brand string (name, tagline, sender, legal line) and the logo path.
- **`prisma/schema.prisma`** — 14 tables. `verification` and `audit_log` are insert-only, enforced by
  Postgres triggers in the init migration (`prisma/sql/001_immutability_triggers.sql` is the source).
  `credit_ledger` is insert-only the same way. The only exception is a `DELETE` inside a transaction
  that sets `app.allow_wipe = 'on'`, which only `seed-wipe` does.
- **`src/lib/db.ts`** — Prisma client with two extensions. Org scoping: every read on an org-owned
  model is filtered to the org in scope (from the server action's context, or the session cookie
  for pages), every write carries it, and a write naming another org throws; operators with no
  active org run unscoped; jobs and seeds use `asOrg()` / `asSystem()`. Audit: every
  create/update/delete writes an `audit_log` row with before/after snapshots, the user, and the org.
  The audit row is written with the base client, so if a surrounding transaction rolls back, the
  audit row stays and records the attempt.
- **`src/lib/verifications.ts`** — `recordVerification()` is the only writer of verification rows:
  one transaction inserts the row and the one-credit ledger debit with the running balance.
- **`src/lib/pricing.ts`** — jurisdiction fee, usage and projection math, ledger invariant check.
- **`src/lib/storage.ts`** — S3 or local driver, keys `{entity_id}/{table}/{row_id}/{timestamp}-{filename}`,
  signed URLs via `/api/files/...`. Evidence metadata (verifier, timestamp, source URL) is stamped on
  the object.
- **`src/lib/status.ts`** — credential status, next-verify-due, and which lead alerts (90/60/30/7,
  overdue) are due. Used by the dashboard, the nightly job, and the seed.
- **`src/lib/matching.ts`** — OIG LEIE / SAM matching: exact NPI → exact name+DOB → Jaro-Winkler
  name match. A differing DOB rules a record out; a name-only match with no DOB is capped at 0.9 and
  flagged for review at ≥ 0.8.
- **`src/lib/nightly.ts`, `src/lib/screening.ts`, `src/lib/nppes.ts`, `src/lib/reports.ts`** — the job and
  report logic, shared by the cron scripts and the in-app "Run now" / export buttons.
- **`prisma/seed-demo.ts`** — the demo. Dates are relative to the run date, so the story holds
  whenever it is shown: 2 expiring ≤30 days, 3 more ≤90, 1 technician license 12 days overdue with
  a full 90/60/30/7/overdue alert history, 1 new-hire pharmacist never verified, one renewal caught
  by re-verification (status_change alert), two screening runs for last month with one pending SAM
  fuzzy match on a prescriber. Fixture extracts live in `prisma/fixtures/`.

## Demo walkthrough (15 minutes)

`make demo` loads everything below.

0. **Operator console.** Sign in as the operator. Three customers, their jurisdictions, tiers,
   balances, this month's verification volume. "This is your business on one screen." Switch into
   Sierra Specialty Pharmacy; the amber banner shows you are inside a customer.
1. **Dashboard.** Tiles read 2 expiring ≤30 days, 5 ≤90, 1 overdue, 1 never verified. Click a tile to switch the list; filter by location, person, type.
2. **A credential record.** Open Marcus Delgado's NV technician license: expired 12 days ago, certificate attached, alert history shows the 90/60/30/7-day and overdue emails, verification history is empty.
3. **Verify, automated.** Switch into Prairie Infusion Partners, open the queue: the CVS Pharmacy #11306 permit (a real public Texas record) carries an "Automated" badge. Verify automatically: the board is queried, the page captured, the expiry corrected, one credit debited, the record locked. Say: "That is one state. The other fifty are the same screen, done by a verifier until each one is worth automating."
3b. **Verify, guided.** Back in Sierra, click "Verify now" on Marcus Delgado's overdue NV license. The NV board link opens pre-built, the license number and name are one click to copy, record what the board shows, paste a screenshot, save. The evidence record appears, locked, and the credential's next verification date moves out a year. If the board showed a different expiry or status, the record is updated and the compliance lead gets a status_change email.
4. **Exclusion screening.** Screening → last month's runs: 17 screened, 0 LEIE matches, 1 SAM match. Open Match review, compare Dr. Okafor against the Ohio record, dismiss as a false positive with a note. The decision is logged with reviewer and time. "Run now" repeats the screening live (or against the fixture in demo mode).
5. **Usage and pricing.** Usage: 3 jurisdictions × $400, Advanced at $10,200, 2,400 credits, 588 used, 1,811 remaining after the verification you just did, projected overage at the current run rate. Switch to Harbor Compounding to see a Core customer heading into overage.
6. **Survey pack.** Reports → PDF for Sierra Specialty Pharmacy: every active credential with last verification, method, result, and the evidence thumbnail. The ZIP holds the full-size files with a manifest.
7. **Audit.** Every change above is in the audit log, filterable by table, user, and row.

## Automated boards

One state board is automated end to end: **Texas pharmacy permits**. The adapter opens the board's
detail page in headless Chromium, reads status, expiration and disciplinary orders, saves a screenshot
and the page text as evidence, and writes the same locked verification record and credit debit as the
guided workbench. The queue shows an "Automated" badge on such credentials and the verify page offers
"Verify automatically"; the nightly job runs the adapter for everything due. If the board is slow,
changed, or unreachable, the error is shown on the credential and the guided form takes over.

Every other state and license type stays on the guided workbench by design. Adding a board is
2Verify engineering work per state: probe it (`docs/boards/PROBE-BRIEF.md`), confirm its terms, write
and test a parser, seed a `board_adapter` row. California's search sits behind a Cloudflare human check
and is not automated; its data is available as DCA bulk files for a later integration.

Runtime: `playwright-core` plus a Chromium (`PW_CHROMIUM_PATH`, or the Docker image's bundled one).
`BOARD_ADAPTERS=off` turns automation off; `RUN_LIVE_BOARD=1 make test` runs the live Texas smoke test.

## Jobs and the monthly runbook

| Job | Schedule (cron container) | Does |
|---|---|---|
| `jobs/nightly.ts` | 02:00 daily | Recomputes every credential's status and next verification date; sends 90/60/30/7-day lead alerts, overdue alerts, and verification-due alerts not yet sent for the current cycle. Idempotent: running it twice sends nothing twice. `--today YYYY-MM-DD` runs it as of another date. |
| `jobs/screening.ts --source oig_leie` | 03:00 on the 1st | Downloads the LEIE CSV (`SCREENING_MODE=live`) or loads the fixture, matches all active people, stores run + matches + PDF report, emails admins with the report attached. |
| `jobs/screening.ts --source sam` | 03:30 on the 1st | Same against SAM.gov Exclusions API v4 (needs `SAM_API_KEY`, free at sam.gov). |

Monthly, the compliance lead:

1. Checks the two screening emails on the 1st (or Screening → both runs present for the month). If a run is missing, `make screening`.
2. Opens Screening → Match review and sets a disposition on every pending match. Confirmed matches are a personnel matter outside this system; the record stays here as evidence.
3. Works the Verify queue until it is empty: each item takes about a minute.
4. Before a survey: Reports → Survey pack PDF + evidence ZIP per location, plus the screening history CSV.

NPPES: saving a person or location with an NPI runs an NPPES lookup (`NPPES_MODE=live`) and records an automated verification on their NPI credential with the JSON response as evidence. "Re-check NPI" on the person page repeats it.

## Security notes

Employee PII (name, DOB for screening, license numbers) is held; no PHI. Encrypt the Postgres volume
at rest, serve over TLS, keep the evidence bucket private (signed URLs only), and rotate
`SESSION_SECRET` if it leaks (this signs out everyone and invalidates local file links).
