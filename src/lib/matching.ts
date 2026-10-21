/**
 * Exclusion-list matching. Shared by the Phase 2 monthly job and the demo seed, which runs the
 * same matcher against fixture extracts so "run now" in the demo reproduces the seeded result.
 *
 * Match order: exact NPI → exact normalized last+first name with the same DOB → fuzzy name
 * (Jaro-Winkler on last and first name separately, weighted 60/40 so a shared surname alone does
 * not flag), flagged for review at >= REVIEW_THRESHOLD.
 */

export interface RosterPerson {
  id: string;
  firstName: string;
  lastName: string;
  dob: Date | null;
  npi: string | null;
}

export interface ExclusionRecord {
  lastName: string;
  firstName: string;
  middleName?: string;
  dob?: string | null; // YYYY-MM-DD or YYYYMMDD
  npi?: string | null;
  state?: string | null;
  [k: string]: unknown;
}

export interface MatchResult {
  personId: string;
  record: ExclusionRecord;
  score: number;
  matchedOn: "npi" | "name_dob" | "fuzzy_name";
}

export const REVIEW_THRESHOLD = 0.8;

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normDob(d: string | null | undefined): string | null {
  if (!d) return null;
  const digits = d.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bM[j] && a[i] === b[j]) {
        aM[i] = bM[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function matchRoster(roster: RosterPerson[], records: ExclusionRecord[]): MatchResult[] {
  const out: MatchResult[] = [];
  for (const p of roster) {
    const pLast = normalizeName(p.lastName);
    const pFirst = normalizeName(p.firstName);
    const pName = `${pLast}, ${pFirst}`;
    const pDob = p.dob ? p.dob.toISOString().slice(0, 10).replace(/-/g, "") : null;
    let best: MatchResult | null = null;
    for (const r of records) {
      let candidate: MatchResult | null = null;
      if (p.npi && r.npi && p.npi === r.npi) {
        candidate = { personId: p.id, record: r, score: 1, matchedOn: "npi" };
      } else {
        const rName = `${normalizeName(r.lastName)}, ${normalizeName(r.firstName)}`;
        if (rName === pName && pDob && normDob(r.dob) === pDob) {
          candidate = { personId: p.id, record: r, score: 1, matchedOn: "name_dob" };
        } else {
          const rDob = normDob(r.dob);
          // A different DOB on both sides rules the record out, however close the name.
          if (pDob && rDob && rDob !== pDob) continue;
          // A name-only match with no DOB to corroborate (common in SAM) is capped at 0.9.
          const nameScore = 0.6 * jaroWinkler(pLast, normalizeName(r.lastName)) + 0.4 * jaroWinkler(pFirst, normalizeName(r.firstName));
          const score = nameScore * (rDob && pDob ? 1 : 0.9);
          if (score >= REVIEW_THRESHOLD) candidate = { personId: p.id, record: r, score, matchedOn: "fuzzy_name" };
        }
      }
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
    if (best) out.push(best);
  }
  return out;
}

/** Minimal CSV parser for the LEIE download (quoted fields, no embedded newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

/** LEIE CSV columns → ExclusionRecord */
export function leieRowToRecord(row: Record<string, string>): ExclusionRecord {
  return {
    lastName: row.LASTNAME ?? "",
    firstName: row.FIRSTNAME ?? "",
    middleName: row.MIDNAME ?? "",
    dob: row.DOB || null,
    npi: row.NPI && row.NPI !== "0000000000" ? row.NPI : null,
    state: row.STATE || null,
    busName: row.BUSNAME,
    general: row.GENERAL,
    specialty: row.SPECIALTY,
    exclType: row.EXCLTYPE,
    exclDate: row.EXCLDATE,
    source: "oig_leie",
  };
}
