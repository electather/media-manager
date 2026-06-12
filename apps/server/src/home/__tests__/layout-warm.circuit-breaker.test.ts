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

  it("trips after consecutive failures across DISTINCT rows, mirroring the scheduler", async () => {
    const breaker = new CircuitBreaker(2);
    composeLayoutSpy.mockRejectedValue(new Error("per-row timeout"));

    // WHY: `listActiveUsers` yields each user exactly once, so the breaker must
    // accumulate consecutive failures across *different* user rows (a shared
    // upstream being offline), not per user id. Keying by user id never tripped
    // in production because no key was ever seen twice.
    await expect(runWarmRow(breaker, "user-1")).rejects.toThrow();
    await expect(runWarmRow(breaker, "user-2")).rejects.toThrow();
    expect(composeLayoutSpy).toHaveBeenCalledTimes(2);

    // Third distinct row is short-circuited — the run has decided the upstream
    // is dead and stops paying the full per-row timeout on every remaining user.
    await expect(runWarmRow(breaker, "user-3")).resolves.toBeUndefined();
    expect(composeLayoutSpy).toHaveBeenCalledTimes(2);
  });

  it("resets the run counter on a success so a recovered upstream keeps composing", async () => {
    const breaker = new CircuitBreaker(2);
    // Fail once, then succeed: the success must clear the consecutive-failure
    // run so a single later failure cannot trip the breaker.
    composeLayoutSpy.mockRejectedValueOnce(new Error("blip"));
    composeLayoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: 0 });

    await expect(runWarmRow(breaker, "user-1")).rejects.toThrow();
    await runWarmRow(breaker, "user-2");
    await runWarmRow(breaker, "user-3");
    // All three rows attempted a compose — no short-circuit, because the success
    // reset the run-level counter between the failure and the next failure.
    expect(composeLayoutSpy).toHaveBeenCalledTimes(3);
    expect(writeLayoutCacheSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps composing while the upstream is healthy", async () => {
    const breaker = new CircuitBreaker(2);
    composeLayoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: 0 });

    await runWarmRow(breaker, "user-1");
    await runWarmRow(breaker, "user-2");
    await runWarmRow(breaker, "user-3");
    expect(composeLayoutSpy).toHaveBeenCalledTimes(3);
    expect(writeLayoutCacheSpy).toHaveBeenCalledTimes(3);
  });
});
