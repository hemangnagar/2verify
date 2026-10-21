# Phase 1 — Platform delta (Prompt A): migration plan

Status: **proposal, awaiting approval before app code is written.** Prompt B (one real automated
board) follows once this is merged.

Files in this folder:

- `schema.proposed.prisma` — the full proposed schema, validated with `prisma validate`.
- `schema.diff` — unified diff against the current `prisma/schema.prisma` (134 added lines).

---

## 1. Schema diff, in words

### New models

| Model | Purpose | Notes |
|---|---|---|
| `Plan` | The five one-pager tiers | `name`, `annual_price_cents`, `credits_per_year`, `overage_cents`, `sort_order`. Seeded: Track 0 / 0 / 600 · Core 120000 / 240 / 500 · Team 555000 / 1200 / 462 · Advanced 1020000 / 2400 / 425 · Enterprise 1395000 / 3600 / 388. |
| `Org` | A customer pharmacy group | `name`, `slug` (unique), `plan_id`, `status` enum `trial / active / suspended`, `subscribed_states text[]`, `term_starts_on` (the subscription year the usage page counts from), `is_demo`. |
| `CreditLedger` | Insert-only credit movements | `org_id`, `delta`, `reason` enum `allotment / verification / adjustment / overage`, `verification_id` (nullable, **unique**, so a verification can never be charged twice), `balance_after`, `note`, `created_by`. DB trigger rejects UPDATE/DELETE, same `app.allow_wipe` escape as the other insert-only tables. |

### `org_id` on every domain table

`entity`, `person`, `credential`, `verification`, `screening_run`, `screening_match`, `alert`:
`org_id` **NOT NULL**, FK to `org` with cascade delete, and every hot index becomes `(org_id, …)`.
There is no `training` table in this codebase (training is a credential category), so nothing to add there.

`audit_log.org_id` is **nullable**: rows about plans, orgs created by an operator, and operator
users have no org. Every row about a customer's data carries that customer's org.

`user.org_id` nullable (null only for operators). `user.role` becomes `operator / org_admin / verifier`.

### Uniqueness moves from global to per-org

| Was | Becomes | Why |
|---|---|---|
| `person.email` unique | unique `(org_id, email)` | Two customers can employ the same person over time |
| `person.npi` unique | unique `(org_id, npi)` | The same prescriber is billed under by several pharmacies |
| `entity.npi`, `entity.dea_number` unique | unique `(org_id, …)` | Consistent; also lets demo orgs reuse generated numbers safely |

### Enum change made now for Prompt B

`VerificationMethod` gains `auto_board` so the enum is migrated once. Prompt B's `board_adapter`
table is **not** in this diff; it ships with Prompt B.

### Stays global (not per-org)

`credential_type` and `board_lookup` are platform catalog, shared by every customer. The brief's
list of domain tables does not include them, and sharing them is the point of the business: the
board table is built once. Per-org overrides can be added in Phase 3 if a customer needs a custom type.

---

## 2. Migration steps (one migration, hand-edited SQL)

Generated with `prisma migrate dev --create-only --name platform`, then edited so existing rows
survive:

1. Create enums `OrgStatus`, `CreditReason`; add `auto_board` to `VerificationMethod`.
2. Create `plan` and insert the five tiers.
3. Create `org`. Insert one org for the existing data: name from the primary entity
   ("Sierra Specialty Pharmacy"), slug `sierra`, plan Advanced, states `{NV,CA,AZ}`, status `active`,
   `term_starts_on` = first of this month a year ago.
4. Add `org_id` **nullable** to the seven domain tables and `audit_log`; backfill every row with that
   org's id; then `SET NOT NULL` on the seven and add the composite indexes. Drop the old global
   unique indexes on `person.email`, `person.npi`, `entity.npi`, `entity.dea_number` and create the
   per-org ones.
5. `user`: add `org_id`; replace the role enum (`admin` → `org_admin`, `verifier` unchanged) by
   creating the new type, casting, and dropping the old; backfill `org_id` for all existing users
   with the migrated org.
6. Create `credit_ledger` with its insert-only trigger; insert one `allotment` row for the migrated
   org (+2400, balance 2400) and one `verification` debit per existing verification row, dated
   at its `verified_at`, so the ledger reconciles with history from day one.
7. Operator user comes from the catalog seed (`SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_PASSWORD`), not
   the migration, so production never ships a hard-coded operator.

`make migrate` on the current demo database then yields a working single-org platform before the
seed is re-run; `make demo-reset` replaces it with the three-org demo.

---

## 3. Org scoping in code

**Context.** `orgContext` (AsyncLocalStorage) holds `{ orgId: string | null, role }`. `withUser()`
sets it from the session on every server action and page; jobs set it per org as they iterate
orgs; seeds set it per org they build.

**Prisma client extension** (same place as the audit extension, `src/lib/db.ts`):

- Models with `org_id` get `where: { orgId }` injected on every read (`findMany`, `findFirst`,
  `findUnique`, `count`, `aggregate`, `groupBy`). Prisma 5+ accepts non-unique filters in
  `findUnique.where`, so a lookup by id in the wrong org returns `null` rather than leaking.
- `create` / `createMany` inject `orgId`; a payload that names a different org throws.
- `update` / `delete` / `upsert` / `updateMany` / `deleteMany` get `orgId` added to `where`, so a
  write against another org's row is "record not found".
- No org in context: operators get unscoped access (the ops console needs it); any other role
  throws before the query runs.
- Nested writes (e.g. `credential.create({ data: { verifications: { create: … } } })`) are not
  used in this codebase; the extension also walks `data` for nested creates on scoped models and
  injects `orgId`, with a test.

**Session.** The JWT gains `orgId` (the user's own org, or the operator's *active* org after
"switch into"). Switching re-issues the cookie and shows a banner on every page:
"Operating as 2Verify in *Sierra Specialty Pharmacy* · exit". Exiting clears it.

**File keys** become `{org_id}/{entity_id}/{table}/{row_id}/{timestamp}-{filename}`; the storage
helper takes the org from context so no caller can write under another org's prefix.

**Tests** (`src/lib/db.int.test.ts`, run against the dev database by `make test-int`): with org A in
context, `findUnique` by an org-B id returns null, `update`/`delete` of an org-B row throws, `create`
with `orgId: B` throws, and a verifier with no org in context cannot query at all.

---

## 4. Credits

- `recordVerification(input)` becomes the single way a verification row is written (manual
  workbench, NPPES, seed, and Prompt B's adapter). It runs one interactive transaction:
  `SELECT … FROM org WHERE id = $1 FOR UPDATE` to serialize the balance, insert the verification,
  insert the ledger row with `delta = -1` and `balance_after = previous + delta`. S3 writes happen
  before, as today, and are referenced by key.
- Debits continue past zero (balance goes negative); the usage page prices the negative part at the
  plan's `overage_cents`. The `overage` reason is reserved for a purchased overage pack (positive
  delta). Screening never touches the ledger.
- `allotment` rows are written when an org is created and when a term renews (operator action in
  the POC; billing automation later).
- Pure function `src/lib/pricing.ts`: `priceFor(org, plan)`, `usageFor(ledgerRows, verificationsByMonth, today)`
  → jurisdiction fee (`40000 × min(states, 51)`), plan price, allotted / used / remaining, run rate
  (verifications in the trailing 90 days ÷ 3), projected year-end overage credits and dollars, and
  the month-by-month series. Unit-tested against the seed numbers below.

---

## 5. Pages

| Route | Role | Content |
|---|---|---|
| `/ops` | operator | Every org: plan, states count, credit balance, verifications this month, credentials expiring ≤30d, open screening matches, status, "Switch into" button |
| `/ops/orgs/new` | operator | Name, slug, plan, states (checkbox grid), status; first org_admin name + email; creates the org, writes the allotment row, creates the user with a generated password, emails the invite |
| `/ops/orgs/[id]` | operator | Org detail: users, ledger with an adjustment form (signed delta + note), renew-term button |
| `/usage` | org_admin, verifier (read) | Subscribed states × $400, plan name and price, allotted / used / remaining, projected overage at the current run rate, month-by-month bars for the term |
| existing pages | org users | Unchanged behaviour, scoped by the extension; nav gains Usage; operator banner when switched in |

Role mapping for existing checks: every `requireAdmin` becomes `requireOrgAdmin` (org_admin, or an
operator switched into an org). Operators switched into an org act as org_admin there, and the audit
row records their user id.

---

## 6. Branding

`src/config/brand.ts` holds every brand string: `name: "2Verify"`, `tagline: "Track. Verify. Stay
Compliant."`, `fromName`, `supportEmail`, `legal: "Shown for evaluation. Built and operated by
Orbitalz LLC."` (PDF footer only). `public/logo.svg` is the logo slot with a wordmark placeholder;
header, login card, email `from`, and PDF headers read from the config. The Compose project name
and package name become `2verify`.

---

## 7. Seed: three orgs

`seed-demo.ts` is refactored into `seedOrg(spec)` driven by three specs. Each org gets its own
users, entities, people, credentials, verifications with evidence files, alerts, screening runs,
and a ledger that reconciles (allotment row first, then one debit per verification, dated at the
verification). "Used" credits therefore equal the count of verification rows, so the seed creates
that many verifications spread over the term (initial PSV of every credential at onboarding,
then re-checks) rather than faking the number with an adjustment.

| Org | States | Plan | Status | Credits | Shape | Story |
|---|---|---|---|---|---|---|
| Sierra Specialty Pharmacy (`sierra`) | NV, CA, AZ | Advanced | active | 2,400 allotted, **588 used**, 1,812 left | the existing two-location seed (17 people, 68 credentials), with verification history densified to 588 rows over the term | the walkthrough org: 2 / 3 / 1 / 1 dashboard, overdue tech, never-verified pharmacist, one pending SAM match |
| Harbor Compounding (`harbor`) | CA | Core | active | 240 allotted, **201 used**, 39 left | 1 location, 6 staff, ~25 credentials | usage page projects overage at the current run rate |
| Prairie Infusion Partners (`prairie`) | TX, OK, KS, MO | Team | **trial** | 1,200 allotted, ~40 used | 2 locations, 10 staff, ~40 credentials | a fresh trial: most credentials never verified, queue full |

Users: one operator from env (`ops@2verify.example.com` by default) and one org_admin per org
(`admin@<slug>.example.com`, password from `SEED_ORG_ADMIN_PASSWORD`). The verifier user stays on
Sierra. The README gets the login matrix.

Board lookups: TX, OK, KS, MO rows are added to the catalog seed (URL and notes, confirmed in
Phase 2 with the real customer).

---

## 8. Tests and docs

- Unit: pricing/usage math against the seed numbers; ledger invariant checker.
- Integration (dev DB): org isolation (section 3); ledger invariant over all seeded orgs;
  `recordVerification` debits exactly once and refuses a second charge for the same verification.
- E2E: operator logs in → `/ops` shows three orgs → switch into Sierra → banner → dashboard story
  → verify → usage page shows 1,811 remaining → exit; org_admin for Harbor cannot see Sierra's data
  (direct URL to a Sierra credential is 404).
- README: Operator section, login matrix, pricing table, how credits move.

---

## 9. Build order and sessions

1. Schema + migration + role rename + org context/extension + `recordVerification` + isolation tests.
   The existing app runs single-org at this point.
2. Operator console, usage page, pricing, branding.
3. Three-org seed, ledger reconciliation, e2e, README.

Steps 1–2 are session one; step 3 is session two. Prompt B starts after that.

---

## 10. Things to decide (defaults stated)

- **Operator audit rows.** When an operator acts inside an org, the audit row carries the org and
  the operator's user id. Default yes.
- **Verifier scope.** Verifiers keep the Phase 0 behaviour: queue, verify page, read-only elsewhere,
  no usage page writes. A "2Verify verifier" who works across customers is just an operator in the
  POC. Default: no separate cross-org verifier role yet.
- **Negative balances.** Allowed, priced as overage on the usage page. Default yes; the alternative
  (block verification at zero) would stall the demo.
- **Prompt B board probing.** This container's proxy blocks the board sites (`search.dca.ca.gov`,
  `nvbop.glsuite.us`, `pharmacy.texas.gov` all refused), and NPPES too. The adapter can be built
  and unit-tested against saved HTML here, but the live probe, terms-of-use check, and the live
  smoke test need to run from the Orbitalz VPS or a laptop. Flagging now so it is not a surprise.
