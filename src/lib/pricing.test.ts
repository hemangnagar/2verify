import { describe, expect, it } from "vitest";
import { checkLedger, computeUsage, jurisdictionFeeCents, type LedgerLike } from "./pricing";
import { addDays } from "./dates";

const today = new Date("2026-10-21T12:00:00Z");
const ADVANCED = { name: "Advanced", annualPriceCents: 1_020_000, creditsPerYear: 2400, overageCents: 425 };
const CORE = { name: "Core", annualPriceCents: 120_000, creditsPerYear: 240, overageCents: 500 };

/** Allotment at term start, then `used` debits spread evenly over the elapsed days. */
function ledgerFor(credits: number, used: number, termStart: Date) {
  const rows: LedgerLike[] = [{ delta: credits, reason: "allotment", createdAt: termStart }];
  const elapsed = Math.max(1, (today.getTime() - termStart.getTime()) / 86_400_000);
  for (let i = 0; i < used; i++) rows.push({ delta: -1, reason: "verification" as const, createdAt: addDays(termStart, (i / used) * elapsed) });
  return rows;
}

describe("jurisdictionFeeCents", () => {
  it("is $400 per state, capped at 51", () => {
    expect(jurisdictionFeeCents(3)).toBe(120_000);
    expect(jurisdictionFeeCents(60)).toBe(51 * 40_000);
    expect(jurisdictionFeeCents(0)).toBe(0);
  });
});

describe("computeUsage against the seed numbers", () => {
  it("Sierra: 3 states, Advanced, 2,400 allotted, 588 used → 1,812 remaining, no overage", () => {
    const termStart = addDays(today, -300);
    const u = computeUsage({ plan: ADVANCED, subscribedStates: ["NV", "CA", "AZ"], termStartsOn: termStart, ledger: ledgerFor(2400, 588, termStart), today });
    expect(u.jurisdictionFeeCents).toBe(120_000);
    expect(u.annualTotalCents).toBe(1_140_000);
    expect(u.allotted).toBe(2400);
    expect(u.used).toBe(588);
    expect(u.remaining).toBe(1812);
    expect(u.projectedOverageCredits).toBe(0);
    expect(u.monthly.length).toBeGreaterThanOrEqual(10);
  });
  it("Harbor: 1 state, Core, 240 allotted, 201 used at 8 months → overage projected", () => {
    const termStart = addDays(today, -240);
    const u = computeUsage({ plan: CORE, subscribedStates: ["CA"], termStartsOn: termStart, ledger: ledgerFor(240, 201, termStart), today });
    expect(u.annualTotalCents).toBe(160_000);
    expect(u.remaining).toBe(39);
    expect(u.runRatePerMonth).toBeGreaterThan(20);
    expect(u.projectedUsedByTermEnd).toBeGreaterThan(240);
    expect(u.projectedOverageCredits).toBeGreaterThan(0);
    expect(u.projectedOverageCents).toBe(u.projectedOverageCredits * 500);
  });
  it("counts purchased overage packs and adjustments separately from the allotment", () => {
    const termStart = addDays(today, -100);
    const ledger = [...ledgerFor(240, 10, termStart), { delta: 50, reason: "overage" as const, createdAt: addDays(today, -1) }, { delta: -3, reason: "adjustment" as const, createdAt: addDays(today, -1) }];
    const u = computeUsage({ plan: CORE, subscribedStates: ["CA"], termStartsOn: termStart, ledger, today });
    expect(u.allotted).toBe(240);
    expect(u.purchased).toBe(50);
    expect(u.adjustments).toBe(-3);
    expect(u.remaining).toBe(277);
  });
});

describe("checkLedger", () => {
  it("accepts a consistent running balance and rejects a broken one", () => {
    const ok = [
      { id: "a", delta: 240, balanceAfter: 240, createdAt: new Date("2026-01-01") },
      { id: "b", delta: -1, balanceAfter: 239, createdAt: new Date("2026-02-01") },
      { id: "c", delta: 10, balanceAfter: 249, createdAt: new Date("2026-03-01") },
    ];
    expect(checkLedger(ok).ok).toBe(true);
    expect(checkLedger([...ok, { id: "d", delta: -1, balanceAfter: 240, createdAt: new Date("2026-04-01") }]).ok).toBe(false);
  });
});
