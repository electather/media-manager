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
 * Direct unit tests for the three-branch decision matrix in
 * `interpretAggregate`. The function consumes only `(data, errors, attempted)`
 * — covering it in isolation here pins each branch independently of the
 * fetcher stubs used in the higher-level home-feed integration tests.
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

  it("throws AllPluginsFailedError when every attempted provider errored", () => {
    expect(() =>
      interpretAggregate(
        "watchHistory@v1",
        build<unknown>({
          attempted: 2,
          data: [],
          errors: [
            { pluginId: "a", connectionId: null, code: "plugin.upstream_error", devMessage: "x" },
            { pluginId: "b", connectionId: null, code: "plugin.timeout", devMessage: "y" },
          ],
        }),
      ),
    ).toThrow(AllPluginsFailedError);
  });
});
