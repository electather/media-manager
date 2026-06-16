import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { rangeToWindow } from "../ranges";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterEach(() => vi.useRealTimers());

describe("rangeToWindow", () => {
  it("maps each range to the matching lookback from now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(rangeToWindow("24h")).toEqual({ since: NOW - DAY });
    expect(rangeToWindow("7d")).toEqual({ since: NOW - 7 * DAY });
    expect(rangeToWindow("30d")).toEqual({ since: NOW - 30 * DAY });
  });
});
