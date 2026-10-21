# Brief: probe three state pharmacy boards for automated license verification

Paste this whole document into ChatGPT (agent mode with browsing, or a session that can run code
with internet access). It is self-contained. The output is a folder of files and a short report
that go back into the 2Verify repo, where the automated verifier is built from them.

## Goal

For each of three state boards of pharmacy, find out whether a **pharmacy permit** lookup on the
board's public website can be done by software without a CAPTCHA and without breaking the site's
terms of use, and **save the result page** so a parser can be written from it. Do them in this order
and report on all three, even if the first one passes:

1. California — DCA License Search, https://search.dca.ca.gov/
2. Nevada — State Board of Pharmacy verification, https://nvbop.glsuite.us/GLSuiteWeb/Clients/NVBOP/Public/Verification/Search.aspx
3. Texas — State Board of Pharmacy license verification, start at https://www.pharmacy.texas.gov/ and follow "License Verification" / "Search"

Rules:

- **Never bypass, solve, or work around a CAPTCHA or bot challenge.** If one appears, record it and move on.
- Look up **pharmacy permits only** (a business location), never an individual's license. Pharmacy permits are public records; using a real individual's number in our demo is not acceptable.
- Be polite: one lookup per board, no rapid retries.

## Step 1 — find a public pharmacy permit number for each state

On each board's site, search by **business name** for a large chain, e.g. "CVS", "Walgreens", or
"Walmart", in that state. Pick one active location and note its permit/license number exactly as the
site shows it (California numbers look like `PHY 12345`; Nevada like `PH12345`; Texas is numeric).
Record the pharmacy name, city, and the number in the report.

## Step 2 — do the lookup by number and capture the page

Option A, run the script (needs Node 22 and the repo):

```bash
git clone <repo-url> 2verify && cd 2verify && npm install
# the script uses Playwright's bundled Chromium; if it is missing: npx playwright install chromium
npm run probe:boards -- --numbers CA=<PHY number>,NV=<PH number>,TX=<number>
```

It writes, per state, `prisma/fixtures/boards/<STATE>/home.html`, `home.png`, `result.html`,
`result.txt`, `result.png`, `verdict.json`. If a board's form has changed and the script reports
UNCLEAR or ERROR, open `scripts/boards.probe.json`, fix the `formUrl`, `numberInput`, or `submit`
selectors for that board after looking at the page, and rerun with `--state XX --number …`.

Option B, by hand in a browser (if the script cannot be run):

1. Open the lookup page. Note whether a CAPTCHA, "verify you are human", or Cloudflare challenge
   appears **before or after** submitting the search.
2. Search by the permit number. If the first result is a summary row, click through to the detail
   page that shows status and expiration date.
3. Save the detail page as **"Webpage, complete"** (`Ctrl/Cmd+S`) → `result.html`, and take a
   full-page screenshot → `result.png`. Save the lookup page the same way → `home.html`, `home.png`.
4. Copy the visible text of the result page into `result.txt`.
5. Fill in the verdict template below as `verdict.json`.

Put the files under `boards/<STATE>/` (CA, NV, TX).

## Step 3 — terms of use

On each board's site, find the terms of use / conditions of use / disclaimer page (often linked in
the footer; for California it is on dca.ca.gov). Save it as `terms.html` in the same folder and
answer in the report, quoting the relevant sentence if there is one:

- Does it prohibit automated queries, scraping, robots, or "systematic retrieval"?
- Does it require attribution or a disclaimer when the data is reused?
- Is there a rate limit or an official API / bulk download offered instead?

## Verdict template (one per state)

```json
{
  "state": "CA",
  "board": "California State Board of Pharmacy (DCA License Search)",
  "probedAt": "2026-10-22T18:00:00Z",
  "permit": { "pharmacyName": "…", "city": "…", "number": "PHY 12345" },
  "lookupUrl": "the URL of the page that shows the result",
  "captchaBeforeSearch": false,
  "captchaAfterSearch": false,
  "resultShows": { "status": "Clear", "expirationDate": "2027-06-30", "disciplineSection": "yes/no, and what it is called" },
  "stableUrlPattern": "e.g. https://search.dca.ca.gov/results?boardCode=0&licenseType=PHY&licenseNumber={number} — or 'form post only'",
  "termsOfUse": { "url": "…", "prohibitsAutomation": false, "quote": "…", "otherRequirements": "…" },
  "verdict": "PASS | CAPTCHA | TERMS_PROHIBIT | UNCLEAR",
  "notes": "anything odd: redirects, session tokens in the URL, JavaScript-only rendering, slow load"
}
```

## What to send back

A zip (or a commit to the repo branch) containing:

```
boards/
  CA/  home.html home.png result.html result.txt result.png terms.html verdict.json
  NV/  (same)
  TX/  (same)
  REPORT.md
```

`REPORT.md` is five to ten lines: the three verdicts, which board you would pick first and why,
and anything that would surprise an engineer building a headless-browser verifier against it
(for example: the result only renders after JavaScript, the detail page needs a second click, the
site sets a session cookie on the home page that the result page requires).

Do not include anything else: no individual license lookups, no bulk downloads, no attempts to
query more than one permit per board.
