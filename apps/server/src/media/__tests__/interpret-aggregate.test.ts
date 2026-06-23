import { describe, it, expect, vi } from "vite-plus/test";

// Stub the env so transitively imported db/client doesn't blow up at module
// load time. This test exercises pure logic only — no runtime DB needed.
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

import { interpretAggregate } from "../service";
import { AllPluginsFailedError } from "../errors";
import type { AggregateResult } from "../service";

/**
 * Unit tests for `interpretAggregate`'s four-branch matrix, isolated from home-feed stubs.
 * Pins each branch via `(data, errors, attempted)` independently.
 */
function build<T>(overrides: Partial<AggregateResult<T[]>>): AggregateResult<T[]> {
  return {
    data: [] as T[],
    errors: [],
    attempted: 0,
    ...overrides,
  };
}

describe("interpretAggregate", () => {
  it("returns empty + partial=false when no providers were attempted", () => {
    const result = interpretAggregate("watchlist@v1", build<unknown>({ attempted: 0 }));
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it("returns empty + partial=false when one provider succeeded with no items", () => {
    const result = interpretAggregate("watchlist@v1", build<unknown>({ attempted: 1, data: [] }));
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it("returns items + partial=false when every provider succeeded with data", () => {
    const result = interpretAggregate(
      "watchlist@v1",
      build<{ id: number }>({ attempted: 2, data: [{ id: 1 }, { id: 2 }] }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.partial).toBe(false);
  });

  it("returns items + partial=true when one provider errored alongside data", () => {
    const result = interpretAggregate(
      "watchlist@v1",
      build<{ id: number }>({
        attempted: 2,
        data: [{ id: 1 }],
        errors: [
          { pluginId: "p", connectionId: null, code: "plugin.upstream_error", devMessage: "x" },
        ],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it("returns empty + partial=true when one provider succeeded with no items and another errored", () => {
    // The bug the fix addresses: previously this combination threw
    // AllPluginsFailedError because `data.length === 0 && errors.length > 0`.
    // Correct outcome is partial-empty so `upcomingForYou`'s ok_empty
    // exemption does not fire on a calendar plugin outage.
    const result = interpretAggregate(
      "calendar@v1",
      build<unknown>({
        attempted: 2,
        data: [],
        errors: [
          { pluginId: "p", connectionId: null, code: "plugin.upstream_error", devMessage: "x" },
        ],
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(true);
  });

  it("soft-degrades to empty + partial when every provider errored but all failures are transient", () => {
    // The "coming up" regression: the sole calendar provider (Trakt) failed
    // because its token refresh was rate-limited (429 → plugin.rate_limited).
    // That is transient — the data is temporarily unavailable, not gone — so
    // the row must render empty and self-heal, never hard-fail to a 503.
    const result = interpretAggregate(
      "calendar@v1",
      build<unknown>({
        attempted: 1,
        data: [],
        errors: [
          {
            pluginId: "trakt",
            connectionId: "c1",
            code: "plugin.rate_limited",
            devMessage: "Trakt refresh 429",
          },
        ],
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.partial).toBe(true);
  });

  it("throws AllPluginsFailedError when every provider errored with a terminal failure", () => {
    expect(() =>
      interpretAggregate(
        "watchHistory@v1",
        build<unknown>({
          attempted: 1,
          data: [],
          errors: [
            { pluginId: "a", connectionId: null, code: "plugin.token_expired", devMessage: "x" },
          ],
        }),
      ),
    ).toThrow(AllPluginsFailedError);
  });

  it("throws AllPluginsFailedError when a terminal failure is mixed with transient ones", () => {
    // Not ALL transient — a genuine auth failure is present, so the surface
    // must hard-fail and prompt the user to act rather than silently empty out.
    expect(() =>
      interpretAggregate(
        "watchHistory@v1",
        build<unknown>({
          attempted: 2,
          data: [],
          errors: [
            { pluginId: "a", connectionId: null, code: "plugin.upstream_error", devMessage: "x" },
            { pluginId: "b", connectionId: null, code: "plugin.bad_credentials", devMessage: "y" },
          ],
        }),
      ),
    ).toThrow(AllPluginsFailedError);
  });
});
