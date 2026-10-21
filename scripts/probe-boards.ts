/**
 * Probe state board license lookups for automation suitability (Prompt B, "Pick the board").
 *
 * For each board in scripts/boards.probe.json (in order), or the one given with --state:
 *   1. open the lookup, detect CAPTCHA / bot-challenge markers
 *   2. look up a public pharmacy permit number (--number, or the one in --numbers CA=…,NV=…,TX=…)
 *   3. save the result page HTML, a full-page screenshot, the visible text, candidate terms-of-use
 *      links, and a verdict.json under prisma/fixtures/boards/<state>/
 *
 * Nothing here bypasses a CAPTCHA. If one appears the verdict says so and the probe moves on.
 *
 * Usage (from a machine with normal internet access):
 *   npx tsx scripts/probe-boards.ts --numbers CA=PHY12345,NV=PH12345,TX=12345
 *   npx tsx scripts/probe-boards.ts --state CA --number PHY12345
 *   npx tsx scripts/probe-boards.ts --state NV --number 12345 --url https://…   # override the form URL
 *   PW_CHROMIUM_PATH=/path/to/chrome npx tsx scripts/probe-boards.ts …          # use an installed Chrome
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Recipe {
  state: string;
  board: string;
  home: string;
  termsCandidates: string[];
  mode: "url" | "form";
  resultUrl?: string;
  formUrl?: string;
  numberInput?: string;
  submit?: string;
  detailLinkText?: string | null;
  expect: { statusWords: string[]; expirationLabel: string };
}

const USER_AGENT = "2Verify-PSV-Probe/0.1 (+compliance verification tool; contact: ops@2verify.example.com)";
const TIMEOUT_MS = 20_000;
const POLITE_DELAY_MS = 5_000;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyState = flag("--state")?.toUpperCase();
const numberArg = flag("--number");
const urlOverride = flag("--url");
const numbers: Record<string, string> = {};
for (const pair of (flag("--numbers") ?? "").split(",").filter(Boolean)) {
  const [k, v] = pair.split("=");
  if (k && v) numbers[k.trim().toUpperCase()] = v.trim();
}
if (onlyState && numberArg) numbers[onlyState] = numberArg;

const recipes = (JSON.parse(readFileSync(path.join(__dirname, "boards.probe.json"), "utf8")) as { boards: Recipe[] }).boards.filter(
  (b) => !onlyState || b.state === onlyState
);
const outRoot = path.join(process.cwd(), "prisma", "fixtures", "boards");

const CAPTCHA_MARKERS = [
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  ".g-recaptcha",
  ".h-captcha",
  "#cf-challenge-running",
  "iframe[src*='challenges.cloudflare.com']",
  "input[name='cf-turnstile-response']",
  "[id*='captcha' i]",
  "[class*='captcha' i]",
  "img[src*='captcha' i]",
];

async function detectCaptcha(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const sel of CAPTCHA_MARKERS) {
    if ((await page.locator(sel).count()) > 0) found.push(sel);
  }
  const text = await bodyText(page);
  if (/verify you are human|are you a robot|complete the security check|enable javascript and cookies to continue/i.test(text)) found.push("challenge-text");
  return found;
}

/** Rendered text with layout whitespace, so table cells stay separate words. */
async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
}

async function termsLinks(page: Page): Promise<string[]> {
  const links = await page.$$eval("a[href]", (as) =>
    as
      .map((a) => ({ text: (a.textContent ?? "").trim(), href: (a as HTMLAnchorElement).href }))
      .filter((l) => /terms|conditions|disclaimer|privacy|use policy|acceptable use|legal/i.test(l.text) || /terms|disclaimer|conditions/i.test(l.href))
      .map((l) => `${l.text} -> ${l.href}`)
  );
  return [...new Set(links)].slice(0, 20);
}

async function genericFormSearch(page: Page, r: Recipe, number: string): Promise<string> {
  const notes: string[] = [];
  let input = r.numberInput ? page.locator(r.numberInput).first() : page.locator("__none__");
  if ((await input.count()) === 0) {
    notes.push("recipe numberInput not found; trying label match");
    input = page.getByLabel(/license|permit|registration|number/i).first();
  }
  if ((await input.count()) === 0) {
    notes.push("label match failed; using first visible text input");
    input = page.locator("input[type=text]:visible, input:not([type]):visible").first();
  }
  if ((await input.count()) === 0) throw new Error("no text input found on the lookup page");
  await input.fill(number);
  let submit = r.submit ? page.locator(r.submit).first() : page.locator("__none__");
  if ((await submit.count()) === 0) {
    notes.push("recipe submit not found; trying role=button /search|verify|submit/");
    submit = page.getByRole("button", { name: /search|verify|submit|look ?up|go/i }).first();
  }
  if ((await submit.count()) > 0) await Promise.all([page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {}), submit.click()]);
  else {
    notes.push("no submit control; pressing Enter");
    await Promise.all([page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {}), input.press("Enter")]);
  }
  return notes.join("; ");
}

async function probe(r: Recipe) {
  const number = numbers[r.state];
  const dir = path.join(outRoot, r.state);
  mkdirSync(dir, { recursive: true });
  const verdict: Record<string, unknown> = { state: r.state, board: r.board, probedAt: new Date().toISOString(), number: number ?? null, userAgent: USER_AGENT };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);
  try {
    // 1. Home page: reachability, captcha, terms links.
    const home = await page.goto(urlOverride ?? r.home, { waitUntil: "domcontentloaded" });
    verdict.homeStatus = home?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {});
    verdict.homeCaptcha = await detectCaptcha(page);
    verdict.termsLinks = await termsLinks(page);
    writeFileSync(path.join(dir, "home.html"), await page.content());
    await page.screenshot({ path: path.join(dir, "home.png"), fullPage: true });

    if (!number) {
      verdict.result = "no permit number supplied; home page captured only";
    } else {
      await page.waitForTimeout(POLITE_DELAY_MS);
      // 2. Lookup.
      if (r.mode === "url" && r.resultUrl && !urlOverride) {
        const res = await page.goto(r.resultUrl.replace("{number}", encodeURIComponent(number)), { waitUntil: "domcontentloaded" });
        verdict.lookupStatus = res?.status() ?? null;
        verdict.lookupUrl = page.url();
      } else {
        if (!urlOverride && r.formUrl && page.url() !== r.formUrl) await page.goto(r.formUrl, { waitUntil: "domcontentloaded" });
        verdict.formNotes = await genericFormSearch(page, r, number);
        verdict.lookupUrl = page.url();
      }
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {});
      verdict.lookupCaptcha = await detectCaptcha(page);
      // 3. Optional detail click.
      if (r.detailLinkText) {
        const link = page.getByRole("link", { name: new RegExp(r.detailLinkText, "i") }).first();
        if ((await link.count()) > 0) {
          await Promise.all([page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {}), link.click()]);
          verdict.detailUrl = page.url();
        }
      }
      // 4. Capture.
      const html = await page.content();
      const text = (await bodyText(page)).replace(/\s+/g, " ").trim();
      writeFileSync(path.join(dir, "result.html"), html);
      writeFileSync(path.join(dir, "result.txt"), text);
      await page.screenshot({ path: path.join(dir, "result.png"), fullPage: true });
      const digits = number.replace(/\D/g, "");
      verdict.numberFoundInPage = text.includes(number) || (digits.length >= 4 && text.includes(digits));
      verdict.statusWordsFound = r.expect.statusWords.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
      verdict.expirationLabelFound = new RegExp(r.expect.expirationLabel, "i").test(text);
      verdict.datesFound = (text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g) ?? []).slice(0, 10);
      const captcha = (verdict.homeCaptcha as string[]).length + (verdict.lookupCaptcha as string[]).length > 0;
      verdict.result = captcha
        ? "CAPTCHA or bot challenge present: NOT suitable for automation"
        : verdict.numberFoundInPage && (verdict.statusWordsFound as string[]).length
          ? "PASS: results returned without CAPTCHA; parser can be built from result.html"
          : "UNCLEAR: page loaded without CAPTCHA but the permit number or a status word was not found; check result.png and adjust the recipe";
    }
  } catch (e) {
    verdict.error = (e as Error).message;
    verdict.result = `ERROR: ${(e as Error).message.split("\n")[0]}`;
    await page.screenshot({ path: path.join(dir, "error.png"), fullPage: true }).catch(() => {});
    writeFileSync(path.join(dir, "error.html"), await page.content().catch(() => ""));
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(dir, "verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(`\n=== ${r.state} — ${r.board}\n${JSON.stringify(verdict, null, 2)}`);
  return verdict;
}

(async () => {
  const summary: Array<{ state: string; result: unknown }> = [];
  for (const r of recipes) {
    const v = await probe(r);
    summary.push({ state: r.state, result: v.result });
    await new Promise((res) => setTimeout(res, POLITE_DELAY_MS));
  }
  console.log("\n=== SUMMARY");
  for (const s of summary) console.log(`${s.state}: ${s.result}`);
  console.log(`\nOutputs under ${outRoot}/<STATE>/ — commit that folder and docs/boards/ and send them back.`);
})();
