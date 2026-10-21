# Board automation records

One file per state once a board has been probed and an adapter built (Prompt B).

- `PROBE-BRIEF.md` — hand this to whoever runs the live probe (a person, or a ChatGPT agent session
  with browsing). The build environment for this repo cannot reach the board sites.
- `<STATE>.md` — written when the adapter ships: the board chosen, URL pattern, terms-of-use check
  with quote and date, parser notes, and known failure modes.

Probe outputs land in `prisma/fixtures/boards/<STATE>/` and are the fixtures for the parser tests.
