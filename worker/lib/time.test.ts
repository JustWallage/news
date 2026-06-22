import { describe, expect, it } from "vitest";
import { amsterdamDate, amsterdamMinuteOfDay } from "./time";

describe("amsterdamDate", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(amsterdamDate(new Date("2026-06-16T23:30:00Z"))).toBe("2026-06-17");
  });
});

describe("amsterdamMinuteOfDay — Telegram slot matching", () => {
  it("converts to local minute-of-day in summer (CEST, UTC+2)", () => {
    // 06:05 UTC → 08:05 Amsterdam = 485.
    expect(amsterdamMinuteOfDay(new Date("2026-06-17T06:05:00Z"))).toBe(485);
  });

  it("converts to local minute-of-day in winter (CET, UTC+1)", () => {
    // 07:05 UTC → 08:05 Amsterdam = 485.
    expect(amsterdamMinuteOfDay(new Date("2026-01-17T07:05:00Z"))).toBe(485);
  });
});
