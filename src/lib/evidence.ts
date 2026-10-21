import { PNG } from "pngjs";
import PDFDocument from "pdfkit";

/**
 * Generators for synthetic evidence files. Everything produced here is visibly a placeholder
 * so no one can mistake it for a real board page or certificate.
 */

// 5x7 bitmap font for the few characters we need to stamp on the PNG.
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(png: PNG, text: string, x0: number, y0: number, scale: number, rgb: [number, number, number]) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === "1")
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) setPixel(png, x + c * scale + dx, y0 + r * scale + dy, rgb);
    x += 6 * scale;
  }
}

function setPixel(png: PNG, x: number, y: number, [r, g, b]: [number, number, number]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
}

function fillRect(png: PNG, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(png, xx, yy, rgb);
}

export interface BoardScreenshotInput {
  boardName: string;
  licenseNumber: string;
  holderName: string;
  status: string;
  expires: string; // YYYY-MM-DD
  capturedAt: string; // YYYY-MM-DD
}

/** 1200x800 PNG that looks like a license-verification result page but says PLACEHOLDER on it. */
export function placeholderBoardScreenshot(input: BoardScreenshotInput): Buffer {
  const png = new PNG({ width: 1200, height: 800 });
  fillRect(png, 0, 0, 1200, 800, [245, 246, 248]);
  fillRect(png, 0, 0, 1200, 90, [30, 58, 95]); // header bar
  drawText(png, input.boardName.slice(0, 40), 40, 30, 4, [255, 255, 255]);
  fillRect(png, 40, 130, 1120, 560, [255, 255, 255]);
  const lines: Array<[string, string]> = [
    ["LICENSE VERIFICATION RESULT", ""],
    ["LICENSE NUMBER", input.licenseNumber],
    ["NAME", input.holderName],
    ["STATUS", input.status],
    ["EXPIRATION DATE", input.expires],
    ["DISCIPLINARY ACTIONS", "NONE ON FILE"],
    ["CAPTURED", input.capturedAt],
  ];
  let y = 170;
  for (const [label, value] of lines) {
    drawText(png, label, 80, y, 3, [90, 90, 90]);
    drawText(png, value, 560, y, 3, [20, 20, 20]);
    y += 60;
  }
  fillRect(png, 40, 700, 1120, 60, [255, 237, 213]);
  drawText(png, "PLACEHOLDER - SYNTHETIC DEMO EVIDENCE - NOT A REAL BOARD PAGE", 60, 718, 3, [180, 70, 0]);
  return PNG.sync.write(png);
}

/** A synthetic certificate / permit document for the demo credential record. */
export async function placeholderCertificatePdf(opts: {
  title: string;
  holder: string;
  number: string;
  issued: string;
  expires: string;
  issuer: string;
}): Promise<Buffer> {
  return pdfBuffer((doc) => {
    doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(3).stroke("#1e3a5f");
    doc.moveDown(4);
    doc.fontSize(26).fillColor("#1e3a5f").text(opts.issuer, { align: "center" });
    doc.moveDown(1);
    doc.fontSize(20).fillColor("#111").text(opts.title, { align: "center" });
    doc.moveDown(2);
    doc.fontSize(14).text("This certifies that", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(22).text(opts.holder, { align: "center" });
    doc.moveDown(1.5);
    doc.fontSize(12).text(`Certificate / License No. ${opts.number}`, { align: "center" });
    doc.text(`Issued ${opts.issued}    Expires ${opts.expires}`, { align: "center" });
    doc.moveDown(6);
    doc.fontSize(10).fillColor("#b45309").text("PLACEHOLDER DOCUMENT — synthetic demo data, not a real credential", { align: "center" });
  });
}

/** Monthly exclusion screening report, stored whether or not there were matches. */
export async function screeningReportPdf(opts: {
  source: "oig_leie" | "sam";
  sourceVersion: string;
  runAt: Date;
  entityName: string;
  roster: Array<{ name: string; role: string; npi: string | null }>;
  matches: Array<{ name: string; score: number; matchedOn: string; sourceSummary: string; disposition: string }>;
}): Promise<Buffer> {
  const sourceName = opts.source === "oig_leie" ? "OIG List of Excluded Individuals/Entities (LEIE)" : "SAM.gov Exclusions";
  return pdfBuffer((doc) => {
    doc.fontSize(18).fillColor("#111").text("Monthly Exclusion Screening Report");
    doc.fontSize(11).fillColor("#444").text(opts.entityName);
    doc.moveDown(0.5);
    doc.fillColor("#111").text(`Source: ${sourceName}`);
    doc.text(`Source version: ${opts.sourceVersion}`);
    doc.text(`Run at: ${opts.runAt.toISOString()}`);
    doc.text(`Persons screened: ${opts.roster.length}`);
    doc.text(`Potential matches: ${opts.matches.length}`);
    doc.moveDown();
    doc.fontSize(13).text("Matches requiring review");
    doc.fontSize(10);
    if (opts.matches.length === 0) doc.fillColor("#15803d").text("No potential matches were found.").fillColor("#111");
    for (const m of opts.matches) {
      doc.fillColor("#b45309").text(`• ${m.name}  (score ${m.score.toFixed(2)}, matched on ${m.matchedOn}, disposition: ${m.disposition})`).fillColor("#111");
      doc.text(`   ${m.sourceSummary}`);
    }
    doc.moveDown();
    doc.fontSize(13).text("Roster screened");
    doc.fontSize(10);
    for (const p of opts.roster) doc.text(`${p.name}  —  ${p.role}${p.npi ? `  —  NPI ${p.npi}` : ""}`);
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#b45309").text("DEMO DATA: this report was generated from a synthetic roster and a synthetic exclusion extract.");
  });
}

export function pdfBuffer(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}
