import { describe, expect, it } from "vitest";
import { amsterdamDate, minuteOfDayInTz } from "./time";

describe("amsterdamDate", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(amsterdamDate(new Date("2026-06-16T23:30:00Z"))).toBe("2026-06-17");
  });
});

describe("minuteOfDayInTz — Telegram slot matching", () => {
  it("resolves one instant to a different minute-of-day per zone", () => {
    const at = new Date("2026-06-17T06:05:00Z");
    // 06:05 UTC → 08:05 Amsterdam (CEST), 02:05 New York (EDT), 15:05 Tokyo.
    expect(minuteOfDayInTz(at, "Europe/Amsterdam")).toBe(485);
    expect(minuteOfDayInTz(at, "America/New_York")).toBe(125);
    expect(minuteOfDayInTz(at, "Asia/Tokyo")).toBe(905);
  });

  it("tracks DST: the same wall time has a different UTC instant", () => {
    // 07:05 UTC → 08:05 Amsterdam in winter (CET, UTC+1) = 485.
    expect(
      minuteOfDayInTz(new Date("2026-01-17T07:05:00Z"), "Europe/Amsterdam"),
    ).toBe(485);
  });
});
