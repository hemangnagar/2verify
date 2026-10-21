import { addDays, dateOnly, daysBetween, firstOfMonth } from "./dates";

/** One-pager pricing: $400 per subscribed jurisdiction per year, capped at 51 jurisdictions. */
export const JURISDICTION_FEE_CENTS = 40_000;
export const MAX_JURISDICTIONS = 51;

export function jurisdictionFeeCents(subscribedStates: number): number {
  return Math.min(Math.max(subscribedStates, 0), MAX_JURISDICTIONS) * JURISDICTION_FEE_CENTS;
}

export interface PlanLike {
  name: string;
  annualPriceCents: number;
  creditsPerYear: number;
  overageCents: number;
}

export interface LedgerLike {
  delta: number;
  reason: "allotment" | "verification" | "adjustment" | "overage";
  createdAt: Date;
}

export interface Usage {
  planName: string;
  planPriceCents: number;
  jurisdictions: number;
  jurisdictionFeeCents: number;
  annualTotalCents: number;
  allotted: number;
  purchased: number;
  adjustments: number;
  used: number;
  remaining: number;
  termStartsOn: Date;
  termEndsOn: Date;
  daysElapsed: number;
  daysLeft: number;
  /** Verifications per 30 days over the trailing 90 days (or the whole term if shorter). */
  runRatePerMonth: number;
  projectedUsedByTermEnd: number;
  projectedOverageCredits: number;
  projectedOverageCents: number;
  /** Month-by-month verifications across the term, oldest first. */
  monthly: Array<{ month: string; verifications: number }>;
}

/** Pure usage math from a plan, subscribed states, and the org's ledger rows. */
export function computeUsage(input: { plan: PlanLike; subscribedStates: string[]; termStartsOn: Date; ledger: LedgerLike[]; today?: Date }): Usage {
  const today = dateOnly(input.today ?? new Date());
  const termStartsOn = dateOnly(input.termStartsOn);
  const termEndsOn = dateOnly(addDays(new Date(Date.UTC(termStartsOn.getUTCFullYear() + 1, termStartsOn.getUTCMonth(), termStartsOn.getUTCDate())), -1));
  const daysElapsed = Math.max(0, daysBetween(termStartsOn, today));
  const daysLeft = Math.max(0, daysBetween(today, termEndsOn));

  const inTerm = input.ledger.filter((l) => l.createdAt >= termStartsOn);
  const allotted = inTerm.filter((l) => l.reason === "allotment").reduce((s, l) => s + l.delta, 0);
  const purchased = inTerm.filter((l) => l.reason === "overage").reduce((s, l) => s + l.delta, 0);
  const adjustments = inTerm.filter((l) => l.reason === "adjustment").reduce((s, l) => s + l.delta, 0);
  const used = -inTerm.filter((l) => l.reason === "verification").reduce((s, l) => s + l.delta, 0);
  const remaining = input.ledger.reduce((s, l) => s + l.delta, 0);

  const windowDays = Math.min(90, Math.max(daysElapsed, 1));
  const windowStart = addDays(today, -windowDays);
  const inWindow = inTerm.filter((l) => l.reason === "verification" && l.createdAt >= windowStart).length;
  const runRatePerMonth = (inWindow / windowDays) * 30;
  const projectedUsedByTermEnd = Math.round(used + (runRatePerMonth / 30) * daysLeft);
  const available = allotted + purchased + adjustments;
  const projectedOverageCredits = Math.max(0, projectedUsedByTermEnd - available);

  const monthly: Usage["monthly"] = [];
  for (let m = firstOfMonth(termStartsOn); m <= today; m = firstOfMonth(m, 1)) {
    const next = firstOfMonth(m, 1);
    monthly.push({ month: m.toISOString().slice(0, 7), verifications: inTerm.filter((l) => l.reason === "verification" && l.createdAt >= m && l.createdAt < next).length });
  }

  const jurisdictions = Math.min(input.subscribedStates.length, MAX_JURISDICTIONS);
  const jfee = jurisdictionFeeCents(jurisdictions);
  return {
    planName: input.plan.name,
    planPriceCents: input.plan.annualPriceCents,
    jurisdictions,
    jurisdictionFeeCents: jfee,
    annualTotalCents: jfee + input.plan.annualPriceCents,
    allotted,
    purchased,
    adjustments,
    used,
    remaining,
    termStartsOn,
    termEndsOn,
    daysElapsed,
    daysLeft,
    runRatePerMonth,
    projectedUsedByTermEnd,
    projectedOverageCredits,
    projectedOverageCents: projectedOverageCredits * input.plan.overageCents,
    monthly,
  };
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

/** Ledger invariant: sum of deltas equals balance_after of the newest row, and every row's balance follows from the previous. */
export function checkLedger(rows: Array<{ delta: number; balanceAfter: number; createdAt: Date; id: string }>): { ok: boolean; problem?: string } {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let running = 0;
  for (const r of sorted) {
    running += r.delta;
    if (r.balanceAfter !== running) return { ok: false, problem: `row ${r.id}: balance_after ${r.balanceAfter} != running ${running}` };
  }
  return { ok: true };
}
