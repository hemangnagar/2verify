import { chromium, type Page } from "playwright-core";

const USER_AGENT = process.env.BOARD_USER_AGENT ?? "2Verify-PSV/0.1 (+primary source verification for pharmacy compliance; contact: support@2verify.example.com)";

/**
 * Open a page in headless Chromium with the descriptive User-Agent, run `fn`, and always close.
 * PW_CHROMIUM_PATH selects an installed browser; otherwise Playwright's downloaded Chromium is used.
 */
export async function openPage<T>(url: string, opts: { timeoutMs: number }, fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 1600 }, locale: "en-US" });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeoutMs);
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    if (res && res.status() >= 400) throw new Error(`Board returned HTTP ${res.status()}`);
    return await fn(page);
  } finally {
    await browser.close();
  }
}
