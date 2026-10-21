import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTxPharmacyPage, txPharmacyPermit } from "./tx";
import { BoardLayoutError } from "./types";

const fixture = readFileSync(path.join(process.cwd(), "prisma/fixtures/boards/TX/result.html"), "utf8");
const fixtureText = readFileSync(path.join(process.cwd(), "prisma/fixtures/boards/TX/result.txt"), "utf8");

/** Minimal page in the board's markup with the fields swapped. */
function mock(fields: { status: string; expires?: string; discipline?: string; name?: string; number?: string }) {
  return `<html><head><title>Texas Pharmacy License # ${fields.number ?? "33978"}</title></head><body>
  <h2 class="looksLikeH3">${fields.name ?? "CVS PHARMACY #11306"}</h2>
  <div id="col1"><h3>License Information</h3>
  <div class="datalabel">License Status</div><div class="dataval">${fields.status}</div>
  <div class="datalabel">License #</div><div class="dataval">${fields.number ?? "33978"}</div>
  <div class="datalabel">Expiration Date</div><div class="dataval">${fields.expires ?? "01/31/2028"}</div>
  <div class="datalabel">Date License Issued</div><div class="dataval">09/21/2021</div>
  <h3>Pharmacy Details</h3>
  <div class="datalabel">Prior Disciplinary Orders* &nbsp;&nbsp; </div><div class="dataval"> ${fields.discipline ?? "No"} </div>
  </div></body></html>`;
}

describe("parseTxPharmacyPage", () => {
  it("parses the saved live page (CVS Pharmacy #11306, Austin)", () => {
    const p = parseTxPharmacyPage(fixture);
    expect(p.found).toBe(true);
    expect(p.licenseNumber).toBe("33978");
    expect(p.holderName).toBe("CVS PHARMACY #11306");
    expect(p.statusText).toBe("Active");
    expect(p.status).toBe("active");
    expect(p.expirationSeen?.toISOString().slice(0, 10)).toBe("2028-01-31");
    expect(p.issuedOn?.toISOString().slice(0, 10)).toBe("2021-09-21");
    expect(p.disciplineFlag).toBe(false);
  });
  it("parses the same page from its visible text", () => {
    const p = parseTxPharmacyPage(fixtureText);
    expect(p.status).toBe("active");
    expect(p.holderName).toBe("CVS PHARMACY #11306");
    expect(p.expirationSeen?.toISOString().slice(0, 10)).toBe("2028-01-31");
  });
  it("maps board status words", () => {
    expect(parseTxPharmacyPage(mock({ status: "Expired", expires: "01/31/2024" })).status).toBe("expired");
    expect(parseTxPharmacyPage(mock({ status: "Delinquent" })).status).toBe("expired");
    expect(parseTxPharmacyPage(mock({ status: "Suspended" })).status).toBe("suspended");
    expect(parseTxPharmacyPage(mock({ status: "Revoked" })).status).toBe("suspended");
    expect(parseTxPharmacyPage(mock({ status: "Probation" })).status).toBe("suspended");
    expect(parseTxPharmacyPage(mock({ status: "Something New" })).status).toBe("mismatch");
  });
  it("treats an active status with a past expiration as expired", () => {
    expect(parseTxPharmacyPage(mock({ status: "Active", expires: "01/01/2020" })).status).toBe("expired");
  });
  it("flags prior disciplinary orders", () => {
    const p = parseTxPharmacyPage(mock({ status: "Active", discipline: "Yes" }));
    expect(p.disciplineFlag).toBe(true);
    expect(p.disciplineText).toMatch(/^Yes/);
  });
  it("recognises a not-found page", () => {
    const p = parseTxPharmacyPage("<html><body><h2>Search Results</h2><p>No records found matching your search criteria.</p></body></html>");
    expect(p.found).toBe(false);
    expect(p.status).toBe("not_found");
  });
  it("throws a layout error when the status field is gone", () => {
    expect(() => parseTxPharmacyPage("<html><body><h2>CVS PHARMACY</h2><div>Permit: 33978</div></body></html>")).toThrow(BoardLayoutError);
  });
  it("builds the stable detail URL", () => {
    expect(txPharmacyPermit.urlFor({ licenseNumber: "33978", licenseType: "pharmacy_permit" })).toBe("https://www.pharmacy.texas.gov/dbsearch/phy_zoom.asp?id=33978&type=1");
    expect(txPharmacyPermit.urlFor({ licenseNumber: "PHY 33978", licenseType: "pharmacy_permit" })).toContain("id=33978");
  });
});

/** Live smoke test against the public permit. Skipped unless RUN_LIVE_BOARD=1. */
describe.skipIf(process.env.RUN_LIVE_BOARD !== "1")("Texas live lookup", () => {
  it("verifies CVS Pharmacy #11306 (permit 33978) against the live board", async () => {
    const r = await txPharmacyPermit.verify({ licenseNumber: "33978", licenseType: "pharmacy_permit" });
    expect(r.holderName).toMatch(/CVS PHARMACY #11306/i);
    expect(["active", "expired", "suspended"]).toContain(r.status);
    expect(r.expirationSeen).toBeInstanceOf(Date);
    expect(r.screenshotPng.length).toBeGreaterThan(10_000);
    expect(r.rawText).toMatch(/License Status/);
  }, 60_000);
});
