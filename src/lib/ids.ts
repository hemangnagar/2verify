/**
 * Generators for identifiers that pass format checks but are random:
 * used only by the demo seed so nothing resembles a real registrant.
 */

/** Deterministic PRNG so `make demo` produces the same data every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

/** 10-digit NPI with a valid Luhn check digit computed over the 80840 prefix. */
export function fakeNpi(rand: () => number): string {
  const body = Array.from({ length: 9 }, () => Math.floor(rand() * 10)).join("");
  // NPIs start with 1 or 2
  const nine = (rand() < 0.5 ? "1" : "2") + body.slice(1);
  return nine + luhnCheckDigit("80840" + nine);
}

export function isValidNpi(npi: string): boolean {
  return /^\d{10}$/.test(npi) && luhnCheckDigit("80840" + npi.slice(0, 9)) === Number(npi[9]);
}

/**
 * DEA number: registrant-type letter, first letter of last name (or 9 for business), six digits,
 * and the DEA check digit: (d1+d3+d5) + 2*(d2+d4+d6), last digit.
 */
export function fakeDea(rand: () => number, lastNameOrBusiness: string, type: "A" | "B" | "F" | "M" = "B"): string {
  const second = /^[A-Za-z]/.test(lastNameOrBusiness) ? lastNameOrBusiness[0].toUpperCase() : "9";
  const d = Array.from({ length: 6 }, () => Math.floor(rand() * 10));
  const check = ((d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5])) % 10;
  return `${type}${second}${d.join("")}${check}`;
}

export function isValidDea(dea: string): boolean {
  if (!/^[A-Z][A-Z9]\d{7}$/.test(dea)) return false;
  const d = dea.slice(2).split("").map(Number);
  return ((d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5])) % 10 === d[6];
}

/** License-number shapes that look like each board's format. */
export function fakeLicenseNumber(rand: () => number, state: string, kind: "pharmacist" | "technician" | "pharmacy" | "intern" | "medical"): string {
  const n = (len: number) => Array.from({ length: len }, () => Math.floor(rand() * 10)).join("");
  switch (`${state}:${kind}`) {
    case "NV:pharmacist": return `${n(5)}`;
    case "NV:technician": return `PT${n(5)}`;
    case "NV:intern": return `IN${n(5)}`;
    case "NV:pharmacy": return `PH${n(5)}`;
    case "CA:pharmacist": return `RPH ${n(5)}`;
    case "CA:technician": return `TCH ${n(6)}`;
    case "CA:pharmacy": return `PHY ${n(5)}`;
    case "CA:medical": return `A ${n(6)}`;
    case "AZ:pharmacist": return `S${n(6)}`;
    case "AZ:technician": return `T${n(6)}`;
    case "AZ:pharmacy": return `Y${n(6)}`;
    case "NV:medical": return `${n(5)}`;
    case "AZ:medical": return `${n(5)}`;
    case "TX:pharmacist": return `${n(5)}`;
    case "TX:technician": return `${n(6)}`;
    case "TX:pharmacy": return `${n(5)}`;
    case "TX:medical": return `${n(5)}`;
    case "OK:pharmacist": return `${n(5)}`;
    case "OK:technician": return `T${n(5)}`;
    case "OK:pharmacy": return `${n(5)}`;
    case "OK:medical": return `${n(5)}`;
    case "KS:pharmacist": return `1-${n(5)}`;
    case "KS:pharmacy": return `2-${n(5)}`;
    case "MO:pharmacist": return `2${n(9)}`;
    case "MO:pharmacy": return `2${n(9)}`;
    default: return n(7);
  }
}
