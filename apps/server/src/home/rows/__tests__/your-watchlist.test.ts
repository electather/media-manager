import { describe, expect, it, vi } from "vite-plus/test";
import provider from "../your-watchlist";
import { makeRowCtx } from "../../__tests__/row-test-helpers";

vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

vi.mock("../../../watchlist", () => ({
  hasAny: vi.fn(),
  listAvailable: vi.fn(),
}));

import { hasAny, listAvailable } from "../../../watchlist";

const hasAnyMock = vi.mocked(hasAny);
const listAvailableMock = vi.mocked(listAvailable);

describe("rows/your-watchlist", () => {
  it("delegates to watchlist.listAvailable and preserves addedAt/addedSource (unified shape, §D)", async () => {
    const ctx = makeRowCtx();
    listAvailableMock.mockResolvedValueOnce({
      items: [
        {
          id: "movie:1",
          tmdbId: "1",
          mediaType: "movie",
          title: "Title 1",
          addedAt: 100,
          addedSource: "manual",
        },
        {
          id: "tv:9",
          tmdbId: "9",
          mediaType: "tv",
          title: "Title 9",
          addedAt: 200,
          addedSource: "plugin",
        },
      ],
      cursor: null,
      partial: false,
    });

    const page = await provider.load(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1", "9"]);
    // Design §D: the home row stops stripping these — the unified
    // `CompactMediaItem` carries them, so home exposes the same shape as the
    // `/watchlist` page rather than two divergent types.
    expect(page.items[0]).toMatchObject({ addedAt: 100, addedSource: "manual" });
    expect(page.items[1]).toMatchObject({ addedAt: 200, addedSource: "plugin" });
    expect(page.cursor).toBeNull();
    expect(page.partial).toBeFalsy();
  });

  it("returns true from eligibility when the user has internal items even without a plugin", async () => {
    const ctx = makeRowCtx();
    hasAnyMock.mockResolvedValueOnce(true);
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValueOnce: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValueOnce(false);

    await expect(provider.eligibility(ctx)).resolves.toBe(true);
  });

  it("falls through to the plugin capability check when the user has no internal items", async () => {
    const ctx = makeRowCtx();
    hasAnyMock.mockResolvedValueOnce(false);
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValueOnce: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValueOnce(true);
    await expect(provider.eligibility(ctx)).resolves.toBe(true);
  });

  it("propagates partial=true from listAvailable", async () => {
    const ctx = makeRowCtx();
    listAvailableMock.mockResolvedValueOnce({ items: [], cursor: null, partial: true });
    const page = await provider.load(ctx, null);
    expect(page.partial).toBe(true);
  });

  it("yields an empty page for a cursor past the bounded preview", async () => {
    const ctx = makeRowCtx();
    listAvailableMock.mockResolvedValueOnce({
      items: [
        {
          id: "movie:1",
          tmdbId: "1",
          mediaType: "movie",
          title: "T",
          addedAt: 1,
          addedSource: "manual",
        },
      ],
      cursor: null,
      partial: false,
    });
    // The row is bounded — an offset cursor past the single page slices to empty.
    const page = await provider.load(ctx, { mode: "offset", n: 12 });
    expect(page.items).toEqual([]);
    expect(page.cursor).toBeNull();
  });
});
