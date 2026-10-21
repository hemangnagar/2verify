import { describe, expect, it } from "vitest";
import { bucketOf, computeNextVerifyDue, computeStatus, expiryAlertsDueBy } from "./status";
import { addDays, dateOnly } from "./dates";

const today = dateOnly(new Date("2026-10-21T15:00:00Z"));

describe("computeStatus", () => {
  it("is expired the day after expiry and expiring inside the lead window", () => {
    expect(computeStatus({ expiresOn: addDays(today, -1), renewalLeadDays: 90, latestResult: null }, today)).toBe("expired");
    expect(computeStatus({ expiresOn: today, renewalLeadDays: 90, latestResult: null }, today)).toBe("expiring");
    expect(computeStatus({ expiresOn: addDays(today, 90), renewalLeadDays: 90, latestResult: null }, today)).toBe("expiring");
    expect(computeStatus({ expiresOn: addDays(today, 91), renewalLeadDays: 90, latestResult: null }, today)).toBe("active");
  });
  it("suspended sticks regardless of dates", () => {
    expect(computeStatus({ expiresOn: addDays(today, 400), renewalLeadDays: 90, latestResult: "suspended" }, today)).toBe("suspended");
  });
  it("non-expiring credentials are unknown until verified", () => {
    expect(computeStatus({ expiresOn: null, renewalLeadDays: 0, latestResult: null }, today)).toBe("unknown");
    expect(computeStatus({ expiresOn: null, renewalLeadDays: 0, latestResult: "active" }, today)).toBe("active");
    expect(computeStatus({ expiresOn: null, renewalLeadDays: 0, latestResult: "not_found" }, today)).toBe("unknown");
  });
});

describe("computeNextVerifyDue", () => {
  it("adds the interval to the last verification, or falls back for never-verified", () => {
    const last = new Date("2026-01-10T12:00:00Z");
    expect(computeNextVerifyDue(last, 365, today).toISOString().slice(0, 10)).toBe("2027-01-10");
    expect(computeNextVerifyDue(null, 365, new Date("2026-08-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-08-01");
  });
});

describe("expiryAlertsDueBy", () => {
  it("lists only the lead alerts whose fire date has passed", () => {
    expect(expiryAlertsDueBy(addDays(today, 21), today).map((a) => a.kind)).toEqual(["lead_90", "lead_60", "lead_30"]);
    expect(expiryAlertsDueBy(addDays(today, 95), today)).toEqual([]);
  });
  it("includes every lead plus overdue once expired, each dated when it would have fired", () => {
    const exp = addDays(today, -12);
    const due = expiryAlertsDueBy(exp, today);
    expect(due.map((a) => a.kind)).toEqual(["lead_90", "lead_60", "lead_30", "lead_7", "overdue"]);
    expect(due[0].on.toISOString().slice(0, 10)).toBe(addDays(exp, -90).toISOString().slice(0, 10));
    expect(due[4].on.toISOString().slice(0, 10)).toBe(addDays(exp, 1).toISOString().slice(0, 10));
  });
});

describe("bucketOf", () => {
  it("places the demo story records in the expected tiles", () => {
    const overdue = bucketOf({ expiresOn: addDays(today, -12), nextVerifyDue: today, verificationCount: 0 }, today);
    expect(overdue).toMatchObject({ overdue: true, expiring30: false, expiring90: false, neverVerified: false });
    const fresh = bucketOf({ expiresOn: addDays(today, 300), nextVerifyDue: addDays(today, -75), verificationCount: 0 }, today);
    expect(fresh).toMatchObject({ neverVerified: true, verifyDue: true });
    const training = bucketOf({ expiresOn: addDays(today, 200), nextVerifyDue: null, verificationCount: 0, psvRequired: false }, today);
    expect(training).toMatchObject({ neverVerified: false, verifyDue: false });
    const soon = bucketOf({ expiresOn: addDays(today, 21), nextVerifyDue: addDays(today, 60), verificationCount: 1 }, today);
    expect(soon).toMatchObject({ overdue: false, expiring30: true, expiring90: true, neverVerified: false, verifyDue: false });
    const mid = bucketOf({ expiresOn: addDays(today, 62), nextVerifyDue: addDays(today, 10), verificationCount: 1 }, today);
    expect(mid).toMatchObject({ expiring30: false, expiring90: true, verifyDue: true });
  });
});
