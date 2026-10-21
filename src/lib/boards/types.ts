import type { VerificationResult } from "@prisma/client";

export type BoardLicenseType = "pharmacy_permit" | "pharmacist" | "technician" | "prescriber";

export interface BoardQuery {
  licenseNumber: string;
  lastName?: string;
  licenseType: BoardLicenseType;
}

export interface BoardResult {
  /** Maps onto VerificationResult; "layout_changed" is an adapter failure, not a board answer. */
  status: VerificationResult;
  expirationSeen: Date | null;
  disciplineFlag: boolean;
  /** Name/holder shown by the board, for the mismatch check and the evidence record. */
  holderName: string | null;
  /** Status text exactly as the board shows it. */
  statusText: string | null;
  /** Visible text of the page, stored as JSON evidence next to the screenshot. */
  rawText: string;
  sourceUrl: string;
  screenshotPng: Buffer;
  fetchedAt: Date;
}

export interface BoardAdapter {
  key: string;
  state: string;
  board: string;
  licenseTypes: BoardLicenseType[];
  /** Build the URL the verifier would open by hand; also the source_url on the evidence record. */
  urlFor(q: BoardQuery): string;
  /** Live lookup with headless Chromium. Throws on network/timeout/layout failure. */
  verify(q: BoardQuery, opts?: { timeoutMs?: number }): Promise<BoardResult>;
}

export class BoardLayoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BoardLayoutError";
  }
}
