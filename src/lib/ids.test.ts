import { describe, expect, it } from "vitest";
import { fakeDea, fakeNpi, isValidDea, isValidNpi, mulberry32 } from "./ids";

describe("fake identifiers", () => {
  it("generates NPIs and DEA numbers with valid check digits, deterministically", () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const npis = Array.from({ length: 50 }, () => fakeNpi(a));
    expect(npis.every(isValidNpi)).toBe(true);
    expect(npis[0]).toBe(fakeNpi(b));
    const deas = Array.from({ length: 50 }, () => fakeDea(a, "Okafor"));
    expect(deas.every(isValidDea)).toBe(true);
    expect(deas[0].startsWith("BO")).toBe(true);
  });
  it("rejects bad check digits", () => {
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidDea("BO1234567")).toBe(false);
  });
});
