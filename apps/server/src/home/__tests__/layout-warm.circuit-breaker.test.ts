import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const composeLayoutSpy = vi.fn();
const writeLayoutCacheSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../service", () => ({
  buildContext: (...args: unknown[]) => ({
    userId: args[0],
    deadlineMs: (args[2] as { deadlineMs?: number })?.deadlineMs,
  }),
  composeLayout: (...args: unknown[]) => composeLayoutSpy(...args),
}));

vi.mock("../internal/layout-cache", () => ({
  write: (...args: unknown[]) => writeLayoutCacheSpy(...args),
}));

const { CircuitBreaker, runWarmRow, PER_ROW_TIMEOUT_SEC, WARM_COMPOSE_BUDGET_MS } =
  await import("../jobs/layout-warm");

describe("layout_warm timeout budget (#428)", () => {
  it("raises the per-row timeout above 60s so a slow plugin connect can resolve", () => {
    // The pre-#428 cap was 60s, which tripped before a slow/offline plugin's
    // TCP connect resolved. The compose budget must stay strictly under it.
    expect(PER_ROW_TIMEOUT_SEC).toBe(120);
    expect(WARM_COMPOSE_BUDGET_MS).toBeLessThan(120_000);
  });
});

describe("CircuitBreaker (#428)", () => {
  it("does not trip on failures below the threshold", () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure("plex");
    breaker.recordFailure("plex");
    // WHY: a couple of transient blips must not disable a source — only a
    // sustained run of failures (an offline upstream) should.
    expect(breaker.shouldSkip("plex")).toBe(false);
  });

  it("trips after N consecutive failures for that source only", () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure("plex");
    breaker.recordFailure("plex");
    breaker.recordFailure("plex");
    expect(breaker.shouldSkip("plex")).toBe(true);
    // Independent sources are tracked separately — one dead upstream must not
    // skip a healthy one.
    expect(breaker.shouldSkip("jellyfin")).toBe(false);
  });

  it("resets the counter on a success so a single later blip cannot re-trip", () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure("plex");
    breaker.recordFailure("plex");
    breaker.recordSuccess("plex");
    breaker.recordFailure("plex");
    // WHY: the counter is *consecutive* failures; a success must clear it so a
    // recovered source is not permanently skipped.
    expect(breaker.shouldSkip("plex")).toBe(false);
  });
});

describe("runWarmRow circuit-breaker integration (#428)", () => {
  beforeEach(() => {
    composeLayoutSpy.mockReset();
    writeLayoutCacheSpy.mockClear();
  });

  it("skips the compose entirely once the source has tripped the breaker", async () => {
    const breaker = new CircuitBreaker(2);
    composeLayoutSpy.mockRejectedValue(new Error("per-row timeout"));

    // Two failures trip the threshold of 2.
    await expect(runWarmRow(breaker, "user-1")).rejects.toThrow();
    await expect(runWarmRow(breaker, "user-1")).rejects.toThrow();
    expect(composeLayoutSpy).toHaveBeenCalledTimes(2);

    // Third call is short-circuited — no further compose attempt (so we never
    // pay the full per-row timeout again on a known-dead source).
    await expect(runWarmRow(breaker, "user-1")).resolves.toBeUndefined();
    expect(composeLayoutSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps composing while the source is healthy", async () => {
    const breaker = new CircuitBreaker(2);
    composeLayoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: 0 });

    await runWarmRow(breaker, "user-1");
    await runWarmRow(breaker, "user-1");
    await runWarmRow(breaker, "user-1");
    expect(composeLayoutSpy).toHaveBeenCalledTimes(3);
    expect(writeLayoutCacheSpy).toHaveBeenCalledTimes(3);
  });
});
