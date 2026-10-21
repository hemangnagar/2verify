# Pharmacy board probe — 2026-10-21
- CA: CAPTCHA — Cloudflare human-verification checkbox before submission; stopped, no permit selected, no result page.
- NV: UNCLEAR overall; technical lookup passed at the currently linked portal https://online.nvbop.org/#/verifylicense; automation terms unresolved.
- NV permit: CVS/PHARMACY #8801, ELKO, PH00641, Active, expires 2028-10-31; Discipline = Yes (no disciplinary documents opened).
- TX: PASS for this limited probe — CVS PHARMACY #11306, AUSTIN, 33978, Active, expires 2028-01-31; no CAPTCHA; no explicit automation prohibition in reviewed verification terms.
- Pick Texas first: number search goes directly to detail; official daily pharmacy CSV is also offered at https://www.pharmacy.texas.gov/dbsearch/tables.asp (not downloaded).
- Nevada brief URL is stale relative to the board’s current verification link; original GLSuite endpoint had a connection failure. New portal needs JavaScript and expands details inline; stale result-count text must not drive parsing.
- Texas result: https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp?id=33978&type=1; name search loads asynchronously; session independence untested; disciplinary history has 30-day/10-year limitations.
- Captures are rendered DOM HTML, not complete offline webpages; screenshots are viewport PNGs converted from browser JPEG because full-page capture failed. Missing CA results and NV terms are intentional, not fabricated.
- One permit-number query each for NV/TX after name discovery; none for CA; no CAPTCHA attempts, individual license lookups, or bulk downloads. Per-state JSON records terms findings, caveats, and unobserved nulls.
