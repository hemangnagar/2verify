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
