import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../jobs/events", () => ({
  on: vi.fn(),
}));

vi.mock("../moods/cluster", () => ({
  invalidateMoodSummary: vi.fn(),
}));

vi.mock("../tonight/section", () => ({
  invalidateTonightSection: vi.fn(),
}));

const { on } = await import("../../jobs/events");
const { __resetRegistration, register } = await import("../jobs/on-watchlist-mutation");

beforeEach(() => {
  __resetRegistration();
  (on as ReturnType<typeof vi.fn>).mockClear();
});

describe("watchlist mutation job registration", () => {
  it("registers mutation invalidators", () => {
    register();

    expect(on).toHaveBeenCalledTimes(2);
  });

  it("registers mutation invalidators after test setup resets registration", () => {
    register();

    expect(on).toHaveBeenCalledTimes(2);
  });
});
