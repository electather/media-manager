import { describe, expect, it } from "vite-plus/test";
import { formatRelativeAirDate } from "../relative-date";

const now = new Date("2026-05-12T12:00:00Z").getTime();

describe("formatRelativeAirDate", () => {
  it("returns 'Today' for the same calendar day", () => {
    expect(formatRelativeAirDate(now + 60 * 1000, now)).toBe("Today");
  });

  it("returns 'Tomorrow' for next day", () => {
    const tomorrow = new Date("2026-05-13T09:00:00Z").getTime();
    expect(formatRelativeAirDate(tomorrow, now)).toBe("Tomorrow");
  });

  it("returns 'Next <weekday>' inside the upcoming week (2-6 days)", () => {
    const inFiveDays = new Date("2026-05-17T09:00:00Z").getTime();
    expect(formatRelativeAirDate(inFiveDays, now)).toMatch(/^Next /);
  });

  it("returns 'In N days' for 7-13 days out", () => {
    const inEightDays = new Date("2026-05-20T09:00:00Z").getTime();
    expect(formatRelativeAirDate(inEightDays, now)).toBe("In 8 days");
  });

  it("returns the full weekday + day + abbreviated month for 14+ days", () => {
    const farOut = new Date("2026-06-15T09:00:00Z").getTime();
    const out = formatRelativeAirDate(farOut, now);
    expect(out).toMatch(/Monday|Sunday|Tuesday|Wednesday|Thursday|Friday|Saturday/);
    expect(out).toMatch(/Jun/);
  });
});
