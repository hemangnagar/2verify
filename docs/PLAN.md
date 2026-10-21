# Pharmacy Compliance Tracker — Phase 0 build plan (for approval)

Status: **proposal, awaiting approval before app code is written.**
Source: the Oct 20, 2026 build brief. This document covers the three things the
brief asked for up front: the Prisma schema, the page list, and the seed-data plan.

---

## 1. Schema

The schema is in `prisma/schema.prisma` (validated with `prisma validate`).
DB-level constraints Prisma cannot express are in
`prisma/sql/001_immutability_triggers.sql` and get appended to the init migration.

### Deviations from the brief's data model (need your yes/no)

| # | Brief said | Proposed | Why |
|---|---|---|---|
| 1 | `credential(subject_type, subject_id)` | `subject_type` + two nullable FKs `person_id`, `entity_id`, CHECK that exactly one is set | Prisma has no polymorphic relations. Real foreign keys mean cascade deletes and joins work, and the dashboard can filter by person or location without a second lookup. |
| 2 | Separate `training` table | **No `training` table.** `CredentialCategory` gains `training`; `credential_type` gains `required_for_roles`. A HIPAA completion is a credential row of type "HIPAA Training" with `expires_on = completed_at + 365`. | One expiry engine, one alert engine, one dashboard query, one export. The brief itself seeds training *as credentials* ("Credentials: about 60 … HIPAA and FWA training"). The training page in Phase 3 becomes a filtered view plus a "who is missing a required course" query, not a second system. |
| 3 | `verification.verified_by` required | nullable; `null` = system job | `auto_api` rows have no human. Avoids a fake "system" user. |
| 4 | (not in brief) | `person.email`, `person.entity_id` | Email is the alert recipient the brief describes. `entity_id` is the home location for the "filter by location" dashboard requirement. |
| 5 | (not in brief) | `is_demo` flag on entity, person, credential, screening_run, alert | Makes `make seed-wipe` a precise delete rather than "drop everything". Verification and audit rows are wiped by cascade from their demo credentials inside the one transaction that sets `app.allow_wipe`. |
| 6 | (not in brief) | `verification.status_before`, `verification.expires_before`, `screening_match.matched_on`, `screening_run.roster` | Make evidence self-describing. A surveyor reading one verification row can see what changed; a screening report can list exactly who was screened without joining to today's roster. |
| 7 | "Prisma middleware" for audit | Prisma **client extension** (`$extends` with a `query` component) | `$use` middleware is deprecated in Prisma 5+. Same effect: every create/update/delete on every model writes an `audit_log` row in the same transaction. |

Everything else (enums, table names, insert-only triggers on `verification` and
`audit_log`, `alert`, `audit_log`, `board_lookup`, `screening_*`) matches the brief.

### Immutability and the seed wipe

`verification` and `audit_log` reject `UPDATE`/`DELETE` via trigger. The only
exception is `DELETE` when the transaction has `SET LOCAL app.allow_wipe = 'on'`,
which only the `seed-wipe` script does. Application code never sets it. This is
the one escape hatch; without it the demo data could never be removed.

### Status computation (nightly job, also on save)

```
expired   if expires_on < today
expiring  if expires_on <= today + renewal_lead_days
suspended if latest verification.result = suspended   (sticky until a later verification says active)
unknown   if no expires_on and no verification ever
active    otherwise
```

`next_verify_due = latest verification.verified_at + reverify_days`, or
`issued_on` (or `hire_date`, or `created_at`) when never verified, so a brand-new
credential lands in the verify queue immediately.

---

## 2. Pages

All pages behind login. Roles: `admin` sees everything; `verifier` sees the
dashboard, credentials (read), the verify queue and verify page, and screening
review (read). Server actions check role.

| Route | Purpose | Phase |
|---|---|---|
| `/login` | Email + password | 0 |
| `/` | **Dashboard.** Four tiles with counts: expiring ≤30d, expiring ≤90d, overdue, never verified. Below: one table, sortable, with tabs for the four buckets plus "verification due". Filters: location, person, credential type, state. | 0 |
| `/credentials` | List with the same filters; export CSV button. | 0 |
| `/credentials/new`, `/credentials/[id]/edit` | Form. Subject picker (person or entity), type, state, number, dates, lead/reverify days (prefilled from type), document upload. | 0 |
| `/credentials/[id]` | **Record page.** Header card, document preview/download (signed URL), verification history (newest first, each with evidence thumbnail), alert history, audit trail for this row. "Verify now" button → `/verify/[id]`. | 0 |
| `/people`, `/people/new`, `/people/[id]` | List; form; person page with their credentials, required-training gaps, and screening history. | 0 |
| `/entities`, `/entities/[id]` | List of locations; entity page with entity credentials and staff at that location. | 0 |
| `/verify` | **Verification queue.** Credentials with `next_verify_due <= today + 30` or never verified, grouped by state, ordered by due date. | 0 |
| `/verify/[credentialId]` | **Guided verify page.** Left: credential + previous verification. Right: board URL (open-in-new-tab) built from `board_lookup.url_template`, copy buttons for number and name, result form, paste-or-upload screenshot (required). Submit = insert verification, update credential if changed, alert on change, set `next_verify_due`. | 0 |
| `/screening` | List of screening runs by month and source, with report PDF link. "Run now" button (admin) — in Phase 0 this runs against the seed roster using the shipped matching logic and a fixture LEIE/SAM extract, so the flow is real end-to-end without network. | 0 |
| `/screening/[runId]` | Run detail: roster screened, matches, report download. | 0 |
| `/screening/matches` | **Match review.** Pending matches, person vs source record side by side, disposition buttons, note. Disposition writes `audit_log`. | 0 |
| `/reports` | **Survey pack.** Per-entity PDF (active credentials, last verified, method, evidence thumbnail) + ZIP of full-size evidence. CSV exports: credentials, screening history, training by employee, audit log. | 0 |
| `/audit` | Audit log viewer (admin). Filter by table, row, user, date. | 1 |
| `/import` | CSV import: upload → column mapping → dry-run preview → commit. | 1 |
| `/settings/credential-types` | Catalog CRUD: lead days, reverify days, required roles. | 0 (read) / 1 (edit) |
| `/settings/board-lookups` | Per state + type URL templates. | 0 (read) / 1 (edit) |
| `/settings/alerts` | Compliance-lead recipient list, lead-day schedule. | 1 |
| `/api/files/[...key]` | Redirects to a 10-minute signed URL after an auth check. | 0 |

Jobs (scripts in `jobs/`, invoked by the cron container; also runnable with `make`):

| Script | Schedule | Does |
|---|---|---|
| `jobs/nightly.ts` | 02:00 daily | Recompute `credential.status`; build verify queue (`next_verify_due`); send lead/overdue/verify_due alerts not yet sent for this expiry cycle; write `alert` rows. |
| `jobs/screening.ts --source oig_leie\|sam` | 1st of month | Download source (Phase 2) or load fixture (Phase 0), match roster, write run + matches, render PDF to S3, email admin. |
| `jobs/nppes-verify.ts` | on save + monthly | NPPES lookup for every person/entity with an NPI → `verification` row (Phase 2; Phase 0 ships the function and uses it to generate the seed's auto_api evidence from a fixture response). |

---

## 3. Seed data plan — "Sierra Specialty Pharmacy"

All names, addresses, numbers are fictional. NPIs are generated with the real
Luhn check digit so they *look* valid but are random; DEA numbers follow the
two-letter + 7-digit format with the real check-digit rule. Emails are
`@example.com`. Dates are computed **relative to the day the seed runs**, so the
demo looks the same whether you show it next week or next quarter.

### Entities (2)

| Name | State | Primary | Credentials |
|---|---|---|---|
| Sierra Specialty Pharmacy | NV, Reno (1200 Sierra Vista Way) | yes | NV pharmacy license, AZ nonresident pharmacy permit, CA nonresident pharmacy permit, DEA registration, NPI, NV controlled-substance registration, professional liability insurance, URAC specialty pharmacy accreditation |
| Sierra Specialty Pharmacy – Sacramento | CA, Sacramento (455 Capitol Mall Dr) | no | CA pharmacy permit, AZ nonresident pharmacy permit, DEA registration, NPI, liability insurance |

### People (17)

Reno (10): 3 pharmacists, 4 technicians, 1 intern, 2 admin staff (one is the compliance lead).
Sacramento (4): 2 pharmacists, 2 technicians.
Prescribers (3): no home location; each has NPI, state medical license, DEA.

Every staff member has a DOB (needed for screening), hire date within the last
six years, one `active = false` former technician *not* counted in the 14 so the
"inactive people are not screened" rule is visible.

### Credentials (~68)

| Group | Count | Notes |
|---|---|---|
| Entity credentials | 13 | as listed above |
| Pharmacist licenses | 11 | 5 home-state + 6 additional (NV↔CA cross-licensed, 2 AZ) |
| Technician licenses | 8 | 6 home-state + 2 cross-state |
| Intern license | 1 | NV |
| Prescriber: license + DEA + NPI | 9 | |
| Staff NPIs (pharmacists) | 5 | never expire; verified via auto_api fixture |
| HIPAA training | 14 | one per staff member |
| FWA training | 7 | pharmacists and technicians at Reno only — leaves Sacramento *missing required training*, which the person page surfaces |

### The six records the demo script walks through

| Story beat | Record | Set up as |
|---|---|---|
| Expiring ≤30 days (1 of 2) | Reno pharmacist (Dr. Priya Ramaswamy, NV RPh) | `expires_on = today + 21`; verified 10 months ago; lead_90/60/30 alerts sent |
| Expiring ≤30 days (2 of 2) | Reno liability insurance policy | `expires_on = today + 27`; lead_90/60 sent |
| Expiring 31–90 days (3) | Sacramento tech CA license (+45), Sacramento CA pharmacy permit (+62), prescriber DEA (+80) | lead_90 sent on the first two |
| **Overdue technician** | Reno technician (Marcus Delgado, NV PTC) | `expires_on = today − 12`; `status = expired`; alerts lead_90/60/30/7 **and** overdue, back-dated to the day each would have fired; certificate PDF uploaded; **no verification rows** (so beat 3 of the demo adds the first one) |
| **Never verified pharmacist** | Sacramento pharmacist (Dr. Elena Vasquez, CA RPh) | `expires_on = today + 300`; `next_verify_due = hire date`; zero verifications; appears in the never-verified tile and at the top of the verify queue |
| Everything else | remaining ~62 | `expires_on` 100–700 days out; one manual_board or auto_api verification 1–11 months ago with placeholder evidence |

### Verifications (~55)

- `auto_api` for every NPI: evidence is a JSON file in the shape of a real NPPES
  2.1 response, generated from the seed person (not fetched).
- `manual_board` for every state license/permit except the two story records:
  evidence is a generated PNG (1200×800) that says "Placeholder board screenshot —
  {board} — {number} — {date}" so it is obviously synthetic but renders as a real
  thumbnail in the survey PDF.
- Two verifications on one pharmacist license show the "expiration changed"
  path: `expires_before` ≠ `expiration_seen`, plus a `status_change` alert row.

### Alerts (~20)

Back-dated per the table above. Recipients: the credential holder's email and
`compliance@sierra-rx.example.com`. In Compose these also exist as real messages
in Mailpit, sent by running the nightly job once at seed time with a fake clock.

### Screening (2 runs, 1 match)

Both runs dated the 1st of last month, roster = 17 active persons (14 staff + 3 prescribers).

- `oig_leie`: source_version = that month's LEIE file date; 0 matches; PDF report stored.
- `sam`: 1 match, `pending`: prescriber **Dr. Robert Okafor** vs a synthetic SAM
  record for "OKAFOR, ROBERT A." in a different state with no NPI — `matched_on =
  fuzzy_name`, `score = 0.84`. Dismissing it as false positive in the demo
  writes `reviewed_by`, `reviewed_at`, and an `audit_log` row.

Fixture files for the Phase 0 matcher: a 200-row synthetic LEIE CSV and a
20-row synthetic SAM extract that contain the Okafor near-miss and no other
roster names, so "run now" in the demo reproduces exactly this result.

### Board lookups (9)

| State | Board | Types seeded | Lookup URL (to confirm during build) |
|---|---|---|---|
| NV | Nevada State Board of Pharmacy | pharmacist, technician, pharmacy | nvbop.glsuite.us GLSuite public verification |
| CA | California State Board of Pharmacy (via DCA) | pharmacist, technician, pharmacy | search.dca.ca.gov |
| AZ | Arizona State Board of Pharmacy | pharmacist, technician, pharmacy | pharmacypermits.az.gov license verification |

Each row has `notes` describing what the page shows (status wording, where the
expiration appears, whether discipline is shown inline), which the verify page
displays under the URL.

### Users (2)

`admin@sierra-rx.example.com` (admin, password from `SEED_ADMIN_PASSWORD`) and
`verifier@sierra-rx.example.com` (verifier). Both are demo users; `seed-wipe`
removes the verifier and leaves whatever admin the env configured.

### Make targets

| Target | Does |
|---|---|
| `make dev` | `docker compose up` (app, postgres, minio, mailpit, cron) |
| `make demo` | migrate → seed credential types + board lookups + env admin → seed Sierra demo → run nightly once with a back-dated clock so alert rows and Mailpit messages exist → generate both screening reports |
| `make demo-reset` | wipe demo rows + files, then `make demo` |
| `make seed-wipe` | one transaction with `app.allow_wipe = 'on'`: delete all `is_demo` rows (cascades to their verifications, alerts, matches), delete their S3 objects, delete the demo verifier user. Prints counts. Refuses to run unless `CONFIRM_WIPE=yes`. |
| `make test` | Vitest (status computation, alert scheduling, LEIE/SAM matching) |
| `make e2e` | Playwright smoke: login → add credential → appears on dashboard |

---

## 4. Build order after approval

1. Repo scaffold: Next.js 15, Tailwind, shadcn/ui, Prisma, Compose (app + postgres + minio + mailpit + cron), Makefile, `.env.example`.
2. Migration with the trigger SQL; audit-log client extension; auth; file storage helper with signed URLs.
3. Seed: catalog, Sierra demo, evidence file generators, fixtures.
4. Pages in this order: dashboard → credential record → verify queue + verify page → screening list/detail/review → reports → people/entities CRUD → credential forms.
5. Jobs: nightly, screening (fixture mode), NPPES function (fixture mode).
6. Tests, README (quickstart, env table, monthly runbook).

Items 1–3 are session one. Items 4–6 are session two.

## 5. Open questions (non-blocking; defaults stated)

- **PDF rendering.** Default: `@react-pdf/renderer` (no headless browser in the
  app container). Alternative: Playwright/Chromium, heavier but pixel-matches
  the web pages.
- **Screenshot capture.** Default for Phase 0: paste (Ctrl+V) or file upload into
  the verify form. The browser extension in the brief is Phase 4.
- **Fuzzy matching.** Default: Jaro-Winkler on normalized "LAST, FIRST" with a
  0.80 threshold for review, 0.92+ auto-flag as likely. Tunable in settings later.
