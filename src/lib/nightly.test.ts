import { describe, expect, it } from "vitest";
import { alreadySent } from "./nightly";

describe("alreadySent", () => {
  const due = new Date("2026-09-01T00:00:00Z");
  it("is true when an alert of that kind went out on or after the due date", () => {
    expect(alreadySent([{ kind: "lead_30", sentAt: new Date("2026-09-01T02:00:00Z") }], "lead_30", due)).toBe(true);
    expect(alreadySent([{ kind: "lead_30", sentAt: new Date("2026-09-10T02:00:00Z") }], "lead_30", due)).toBe(true);
  });
  it("is false for a different kind or an alert from the previous expiry cycle", () => {
    expect(alreadySent([{ kind: "lead_60", sentAt: new Date("2026-09-01T02:00:00Z") }], "lead_30", due)).toBe(false);
    expect(alreadySent([{ kind: "lead_30", sentAt: new Date("2025-09-01T02:00:00Z") }], "lead_30", due)).toBe(false);
  });
});
