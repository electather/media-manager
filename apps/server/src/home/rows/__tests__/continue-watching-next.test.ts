import { describe, expect, it, vi } from "vite-plus/test";
import provider from "../continue-watching-next";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";

// The row delegates to `continueWatchingNextSource`, whose sibling
// `continueWatchingActiveSource` pulls the media barrel (the `media → db → env`
// graph) for `isActiveContinueWatchingEntry`, so the env must be stubbed.
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

describe("rows/continue-watching-next", () => {
  it("includes server-stitched nextUp items and tags nextUpFromServer=true", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({
      items: [
        {
          item: libraryItem({ tmdbId: "1", type: "show", season: 1, episode: 1 }),
          progressMs: 100,
          nextUp: libraryItem({
            tmdbId: "1",
            type: "episode",
            season: 1,
            episode: 2,
            title: "Up next",
          }),
        },
      ],
      partial: false,
    });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.seriesContext?.nextUpFromServer).toBe(true);
    expect(page.cursor).toBeNull();
  });

  it("includes entries with no progress (`progressMs == null`)", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({
      items: [
        { item: libraryItem({ tmdbId: "1", type: "show", season: 1, episode: 1 }) },
        { item: libraryItem({ tmdbId: "2", type: "show" }), progressMs: 100 },
      ],
      partial: false,
    });
    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
  });

  it("propagates partial=true", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({ items: [], partial: true });
    const page = await provider.fetchPage(ctx, null);
    expect(page.partial).toBe(true);
  });
});
