import { afterEach, describe, expect, it } from "vite-plus/test";

import { setLocale } from "@/paraglide/runtime";
import { compactRelativeTime, formatDuration, relativeTime, shortDate } from "../time-format";

const NOW = new Date("2026-05-12T12:00:00Z");

afterEach(() => {
  void setLocale("en", { reload: false });
});

describe("relativeTime", () => {
  it("formats long relative time through Paraglide", () => {
    expect(relativeTime(new Date("2026-05-12T11:55:00Z"), { now: NOW })).toBe("5 minutes ago");
    expect(relativeTime(new Date("2026-05-12T14:00:00Z"), { now: NOW })).toBe("in 2 hours");
  });

  it("uses the localized never label when no timestamp is available", () => {
    expect(relativeTime(null)).toBe("never");
  });
});

describe("compactRelativeTime", () => {
  it("keeps diagnostics-style narrow buckets for recent timestamps", () => {
    expect(compactRelativeTime(new Date("2026-05-12T11:55:00Z"), { now: NOW })).toBe("5m ago");
    expect(compactRelativeTime(new Date("2026-05-10T12:00:00Z"), { now: NOW })).toBe("2d ago");
  });

  it("falls back to a localized short date after the seven-day window", () => {
    expect(compactRelativeTime(new Date("2026-05-01T12:00:00Z"), { now: NOW })).toBe("May 1");
  });

  it("uses the localized missing label when no timestamp is available", () => {
    expect(compactRelativeTime(null)).toBe("—");
  });
});

describe("shortDate", () => {
  it("uses Paraglide datetime formatting", () => {
    expect(shortDate(new Date("2026-05-01T12:00:00Z"))).toBe("May 1");
  });
});

describe("formatDuration", () => {
  it("formats millisecond and second buckets with shared messages", () => {
    expect(formatDuration(0.5)).toBe("<1 ms");
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1_234)).toBe("1.23 s");
    expect(formatDuration(12_300)).toBe("12.3 s");
  });

  it("formats minute buckets with a seconds remainder", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("uses the localized missing label when no duration is available", () => {
    expect(formatDuration(null)).toBe("—");
  });
});
