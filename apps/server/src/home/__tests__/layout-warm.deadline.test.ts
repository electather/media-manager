import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";

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

// Capture every buildContext call so we can assert the deadline opts.
const buildContextSpy = vi.fn();
// Stub composeLayout so the test does not need a real plugin runtime or
// catalog. The rev 6 regression is about whether the warm handler hits the
// 60s per-row timeout, not whether the composer assembles a particular shape.
const composeLayoutSpy = vi.fn();
const writeLayoutCacheSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../service", () => ({
  buildContext: (...args: unknown[]) => {
    buildContextSpy(...args);
    return { userId: args[0], deadlineMs: (args[2] as { deadlineMs?: number })?.deadlineMs };
  },
  composeLayout: (...args: unknown[]) => composeLayoutSpy(...args),
}));

vi.mock("../repo", () => ({
  write: (...args: unknown[]) => writeLayoutCacheSpy(...args),
}));

const { runWarmComposeForUser, WARM_COMPOSE_BUDGET_MS } = await import("../jobs/layout-warm");

describe("host.home.layout_warm deadline propagation (rev 6 regression)", () => {
  beforeEach(() => {
    buildContextSpy.mockClear();
    composeLayoutSpy.mockClear();
    writeLayoutCacheSpy.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets ctx.deadlineMs to now + WARM_COMPOSE_BUDGET_MS", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-05-23T12:00:00Z").getTime();
    vi.setSystemTime(start);
    composeLayoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: start });

    await runWarmComposeForUser("user-1");

    expect(buildContextSpy).toHaveBeenCalledTimes(1);
    const opts = buildContextSpy.mock.calls[0]![2] as { deadlineMs?: number };
    expect(opts.deadlineMs).toBe(start + WARM_COMPOSE_BUDGET_MS);
  });

  it("forwards ~45s budget to composeLayout and writes back the returned partial blob", async () => {
    // `composeLayout` is stubbed — this test does not exercise the live
    // leaf-level abort path (that's covered by `invoke.deadline-clip.test.ts`
    // and `enrich.deadline.test.ts`). The assertion here is that the warm
    // handler hands the composer a budget in the expected window and writes
    // back whatever blob the composer returns (partial or full).
    const partialBlob = {
      hero: { slides: [] }, // hero collapsed to empty when slow pool dropped
      rows: [
        {
          rowId: "trendingNow",
          kind: "trendingNow",
          titleKey: "row.trending",
          initialCursor: null,
        },
      ],
      generatedAt: Date.now(),
    };
    composeLayoutSpy.mockImplementation(async (ctx: { deadlineMs?: number }) => {
      // Assert the budget is what we expect (~45s) — the composer would have
      // returned partial because of leaf-level AbortError; here we just
      // confirm the budget flowed through.
      expect(ctx.deadlineMs).toBeGreaterThan(Date.now() + 40_000);
      expect(ctx.deadlineMs).toBeLessThan(Date.now() + 50_000);
      return partialBlob;
    });

    await expect(runWarmComposeForUser("user-2")).resolves.toBeUndefined();

    expect(writeLayoutCacheSpy).toHaveBeenCalledTimes(1);
    expect(writeLayoutCacheSpy).toHaveBeenCalledWith("user-2", partialBlob);
  });

  it("does not throw on a partial layout — writeback always proceeds", async () => {
    composeLayoutSpy.mockResolvedValue({ hero: null, rows: [], generatedAt: 0 });
    await expect(runWarmComposeForUser("user-3")).resolves.toBeUndefined();
    expect(writeLayoutCacheSpy).toHaveBeenCalledTimes(1);
  });
});
