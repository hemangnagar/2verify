/**
 * Texas State Board of Pharmacy — automated pharmacy-permit verification.
 * See docs/boards/TX.md for the probe, the terms-of-use check, and the caveats.
 *
 * Detail page: https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp?id={number}&type=1
 * Fields are <div class="datalabel">Label</div><div class="dataval">Value</div> pairs; the permit
 * name is the <h2>; "Prior Disciplinary Orders*" is its own pair. The parser works on the rendered
 * text as well, so a markup change that keeps the labels still parses.
 */
import type { VerificationResult } from "@prisma/client";
import { BoardLayoutError, type BoardAdapter, type BoardResult } from "./types";
import { openPage } from "./browser";

export const TX_DETAIL_URL = "https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp";
export const TX_SEARCH_URL = "https://www.pharmacy.texas.gov/dbsearch/";

export interface TxParsed {
  found: boolean;
  licenseNumber: string | null;
  holderName: string | null;
  statusText: string | null;
  status: VerificationResult;
  expirationSeen: Date | null;
  issuedOn: Date | null;
  disciplineFlag: boolean;
  disciplineText: string | null;
}

const STATUS_MAP: Array<[RegExp, VerificationResult]> = [
  [/^active/i, "active"],
  [/^(expired|delinquent|lapsed)/i, "expired"],
  [/^(suspended|revoked|probat|restricted|cancell?ed|surrender|inactive|retired)/i, "suspended"],
];

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|h\d|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function parseUsDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
}

/** Parse either the page HTML or its visible text. Pure; unit-tested against saved and mocked pages. */
export function parseTxPharmacyPage(htmlOrText: string): TxParsed {
  const isHtml = /<\w+[^>]*>/.test(htmlOrText);
  const text = (isHtml ? stripTags(htmlOrText) : htmlOrText).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const valueAfter = (label: RegExp): string | null => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return null;
    // Value may be on the same line after the label, or the next non-empty line.
    const same = lines[i].replace(label, "").trim();
    if (same) return same;
    return lines[i + 1] ?? null;
  };

  const notFound = /no (records?|results?) (were )?found|license (number )?not found|invalid license|no matching/i.test(text);
  const statusText = valueAfter(/^License Status\b/i);
  const licenseNumber = valueAfter(/^License #\b/i) ?? text.match(/Texas Pharmacy License #\s*(\d+)/i)?.[1] ?? null;
  if (!statusText) {
    if (notFound) return { found: false, licenseNumber, holderName: null, statusText: null, status: "not_found", expirationSeen: null, issuedOn: null, disciplineFlag: false, disciplineText: null };
    throw new BoardLayoutError("Texas page did not contain a 'License Status' field; the board layout may have changed");
  }

  // Holder: the <h2> in HTML; in text, the line right before "License Information".
  let holderName: string | null = null;
  if (isHtml) {
    const h2 = htmlOrText.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    holderName = h2 ? stripTags(h2[1]).replace(/\s+/g, " ").trim() : null;
  }
  if (!holderName) {
    const i = lines.findIndex((l) => /^License Information$/i.test(l));
    holderName = i > 0 ? lines[i - 1] : null;
  }

  const expirationSeen = parseUsDate(valueAfter(/^Expiration Date\b/i));
  const issuedOn = parseUsDate(valueAfter(/^Date License Issued\b/i));
  const disciplineText = valueAfter(/^Prior Disciplinary Orders\*?/i);
  const disciplineFlag = !!disciplineText && /^yes/i.test(disciplineText);

  let status: VerificationResult = "mismatch";
  for (const [re, s] of STATUS_MAP) {
    if (re.test(statusText)) {
      status = s;
      break;
    }
  }
  if (status === "active" && expirationSeen && expirationSeen.getTime() < Date.now() - 86_400_000) status = "expired";

  return { found: true, licenseNumber, holderName, statusText, status, expirationSeen, issuedOn, disciplineFlag, disciplineText };
}

export const txPharmacyPermit: BoardAdapter = {
  key: "tx-pharmacy-permit",
  state: "TX",
  board: "Texas State Board of Pharmacy",
  licenseTypes: ["pharmacy_permit"],
  urlFor(q) {
    return `${TX_DETAIL_URL}?id=${encodeURIComponent(q.licenseNumber.replace(/\D/g, ""))}&type=1`;
  },
  async verify(q, opts = {}) {
    const url = this.urlFor(q);
    const fetchedAt = new Date();
    return openPage(url, { timeoutMs: opts.timeoutMs ?? 20_000 }, async (page) => {
      // The detail page renders server-side; wait for the status label or a not-found notice.
      await page.waitForFunction(() => /License Status|no records? found|not found/i.test(document.body?.innerText ?? ""), null, { timeout: opts.timeoutMs ?? 20_000 }).catch(() => {});
      const html = await page.content();
      const rawText = await page.evaluate(() => document.body?.innerText ?? "");
      const parsed = parseTxPharmacyPage(html);
      if (parsed.found && parsed.licenseNumber && parsed.licenseNumber.replace(/\D/g, "") !== q.licenseNumber.replace(/\D/g, "")) {
        throw new BoardLayoutError(`Texas page shows license ${parsed.licenseNumber}, expected ${q.licenseNumber}`);
      }
      const screenshotPng = await page.screenshot({ fullPage: true, type: "png" });
      return {
        status: parsed.status,
        expirationSeen: parsed.expirationSeen,
        disciplineFlag: parsed.disciplineFlag,
        holderName: parsed.holderName,
        statusText: parsed.statusText,
        rawText,
        sourceUrl: url,
        screenshotPng: Buffer.from(screenshotPng),
        fetchedAt,
      } satisfies BoardResult;
    });
  },
};
