import { describe, expect, it } from "vite-plus/test";

import { formatRelativeAirDate } from "../lib/relative-date";

const NOW = Date.UTC(2026, 4, 1, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("formatRelativeAirDate", () => {
  it("returns 'Aired' for past dates", () => {
    expect(formatRelativeAirDate(NOW - DAY, NOW)).toBe("Aired");
  });

  it("returns 'Today' for same-day", () => {
    expect(formatRelativeAirDate(NOW + 1_000, NOW)).toBe("Today");
  });

  it("returns 'Tomorrow' for next-day", () => {
    expect(formatRelativeAirDate(NOW + DAY + 1_000, NOW)).toBe("Tomorrow");
  });

  it("returns 'In N days' for 2-6 days", () => {
    expect(formatRelativeAirDate(NOW + 5 * DAY, NOW)).toBe("In 5 days");
  });

  it("returns weekday formatted string for 7+ days", () => {
    const out = formatRelativeAirDate(NOW + 10 * DAY, NOW);
    expect(out).toMatch(/[A-Za-z]+/);
    expect(out).not.toMatch(/^In \d+ days$/);
  });
});
