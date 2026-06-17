import { describe, expect, it } from "vitest";
import { amsterdamDate, amsterdamHour, amsterdamMinuteOfDay } from "./time";

describe("amsterdamHour — DST-safe cron gating", () => {
  it("maps 04:20 UTC to 06:00 in summer (CEST, UTC+2)", () => {
    expect(amsterdamHour(new Date("2026-06-17T04:20:00Z"))).toBe(6);
  });

  it("maps 05:20 UTC to 06:00 in winter (CET, UTC+1)", () => {
    expect(amsterdamHour(new Date("2026-01-17T05:20:00Z"))).toBe(6);
  });

  it("leaves the off-cron fire at a non-6 hour", () => {
    expect(amsterdamHour(new Date("2026-06-17T05:20:00Z"))).toBe(7);
    expect(amsterdamHour(new Date("2026-01-17T04:20:00Z"))).toBe(5);
  });
});

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
