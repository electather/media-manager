import { describe, expect, it, vi } from "vite-plus/test";
import provider from "../your-watchlist";
import { makeRowCtx } from "../../__tests__/row-test-helpers";

vi.mock("../../../watchlist", () => ({
  hasAny: vi.fn(),
  listAvailable: vi.fn(),
}));

import { hasAny, listAvailable } from "../../../watchlist";

const hasAnyMock = vi.mocked(hasAny);
const listAvailableMock = vi.mocked(listAvailable);

describe("rows/your-watchlist", () => {
  it("delegates fetchPage to watchlistService.listAvailable and strips watchlist-only fields", async () => {
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

    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1", "9"]);
    // `addedAt` and `addedSource` belong to the watchlist wire only.
    for (const item of page.items) {
      expect(item).not.toHaveProperty("addedAt");
      expect(item).not.toHaveProperty("addedSource");
    }
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
    const page = await provider.fetchPage(ctx, null);
    expect(page.partial).toBe(true);
  });

  it("returns empty page when called with a non-null cursor", async () => {
    const ctx = makeRowCtx();
    listAvailableMock.mockClear();
    const page = await provider.fetchPage(ctx, "ignored");
    expect(page.items).toEqual([]);
    expect(page.cursor).toBeNull();
    expect(listAvailableMock).not.toHaveBeenCalled();
  });
});
