# Texas State Board of Pharmacy — automated pharmacy-permit verification

**Chosen board for Prompt B.** Probe run 2026-10-21 from outside the build environment
(see `PROBE-REPORT-2026-10-21.md` and `prisma/fixtures/boards/TX/`).

| Item | Finding |
|---|---|
| Lookup | https://www.pharmacy.texas.gov/dbsearch/ — pharmacy search by name or permit number |
| Stable detail URL | `https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp?id={number}&type=1` (observed for one permit; session independence to be confirmed by the live smoke test) |
| CAPTCHA | None before or after search |
| Terms | https://www.pharmacy.texas.gov/dbsearch/pop_terms.asp — accuracy/timeliness disclaimer; no scraping, robot, rate-limit, or attribution clause found. Absence of a prohibition is not affirmative permission; the adapter stays polite (1 query / 5 s, descriptive User-Agent, one retry). |
| Official bulk data | Daily pharmacy CSV at https://www.pharmacy.texas.gov/dbsearch/tables.asp — a later option for nightly refresh instead of per-permit lookups |
| Demo permit | CVS PHARMACY #11306, Austin, permit 33978, Active, expires 2028-01-31 (public pharmacy permit; no individual license is used) |
| Discipline | Detail page has "Prior Disciplinary Orders*: No/Yes" plus a "Remedial Plans and/or Inspection Reports" section. The board states orders are current as of 30 days prior and orders older than 10 years are not online, so "No" is not "never". |
| Parser caveats | Name search loads asynchronously; number search goes straight to the detail page. The detail page lists incidental employee names and license links; the adapter must never follow them. |

Why not the others: California's DCA search shows a Cloudflare "verify you are human" check before the
search can be submitted (stopped, nothing bypassed). Nevada's current portal (https://online.nvbop.org/#/verifylicense)
returned a result without a CAPTCHA, but it is a JavaScript single-page app with no per-record URL and
its terms could not be located, so it is second in line.

## Adapter (built)

| Item | Where |
|---|---|
| Adapter | `src/lib/boards/tx.ts` — key `tx-pharmacy-permit`, pharmacy permits only |
| Parser | `parseTxPharmacyPage()` works on the HTML or the visible text; tested in `src/lib/boards/tx.test.ts` against the saved page and mocked expired / delinquent / suspended / revoked / probation / not-found / layout-changed pages |
| Browser | `src/lib/boards/browser.ts` — headless Chromium via `playwright-core`, descriptive User-Agent (`BOARD_USER_AGENT`), 20 s timeout, one retry, 1 query / 5 s per board (`board_adapter.min_interval_sec`) |
| Orchestration | `src/lib/boards/index.ts` — evidence (screenshot PNG + page text JSON) to storage, then `recordVerification()` (row + credit debit in one transaction), credential update if the board disagrees, status_change alert, next due date; failures are written to `credential.last_auto_error` and `board_adapter.last_error` and the credential stays in the manual queue |
| Enablement | `board_adapter` row (TX, Pharmacy Permit) seeded by `make seed`; `BOARD_ADAPTERS=off` disables all adapters on an instance |
| Nightly | `jobs/nightly.ts` runs every enabled adapter for credentials due in the queue before the alert pass |
| Live smoke test | `RUN_LIVE_BOARD=1 npx vitest run src/lib/boards` — verifies permit 33978 against the live board; skipped otherwise |
| Demo record | Prairie Infusion Partners has a third location "CVS Pharmacy #11306 (public permit, adapter demo)" with permit 33978, never verified, expiry seeded one year short so the automated check visibly corrects it |

Status mapping: Active → active (expired if the shown expiration is in the past); Expired / Delinquent /
Lapsed → expired; Suspended / Revoked / Probation / Restricted / Cancelled / Surrendered / Inactive /
Retired → suspended; anything else → mismatch for a human to read. "Prior Disciplinary Orders: Yes"
sets the discipline flag and the alert says so.

What the adapter never does: follow the employee links on the detail page, search by name, query
more than one permit per 5 seconds, or retry a layout failure.
