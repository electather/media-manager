import { describe, expect, it } from "vite-plus/test";
import provider from "../continue-watching-active";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import { decodeCursor } from "../../cursor";
import { z } from "zod";

const offsetSchema = z.object({ offset: z.number().int().min(0) });

describe("rows/continue-watching-active", () => {
  it("filters out entries with progress >= 0.85", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({
      items: [
        {
          item: libraryItem({ tmdbId: "1", type: "movie", durationSec: 100 }),
          progressMs: 30_000,
          lastPlayedAt: "2026-01-01T00:00:00Z",
        },
        {
          item: libraryItem({ tmdbId: "2", type: "movie", durationSec: 100 }),
          progressMs: 95_000,
          lastPlayedAt: "2026-01-02T00:00:00Z",
        },
      ],
      partial: false,
    });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
  });

  it("sorts by lastPlayedAt descending", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({
      items: [
        {
          item: libraryItem({ tmdbId: "old", durationSec: 100 }),
          progressMs: 5000,
          lastPlayedAt: "2026-01-01T00:00:00Z",
        },
        {
          item: libraryItem({ tmdbId: "fresh", durationSec: 100 }),
          progressMs: 5000,
          lastPlayedAt: "2026-02-01T00:00:00Z",
        },
      ],
      partial: false,
    });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["fresh", "old"]);
  });

  it("emits a cursor when the eligible set exceeds page size", async () => {
    const ctx = makeRowCtx();
    const items = Array.from({ length: 14 }, (_, n) => ({
      item: libraryItem({ tmdbId: String(n), durationSec: 100 }),
      progressMs: 1000,
      lastPlayedAt: `2026-01-${String(n + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({ items, partial: false });

    const page = await provider.fetchPage(ctx, null);
    expect(page.items).toHaveLength(12);
    expect(page.cursor).not.toBeNull();
    expect(decodeCursor(page.cursor!, offsetSchema)).toEqual({ offset: 12 });
  });

  it("propagates partial=true from the underlying aggregate", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getContinueWatchingFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getContinueWatchingFeed.mockResolvedValue({
      items: [
        {
          item: libraryItem({ tmdbId: "1", durationSec: 100 }),
          progressMs: 1000,
          lastPlayedAt: "2026-01-01T00:00:00Z",
        },
      ],
      partial: true,
    });
    const page = await provider.fetchPage(ctx, null);
    expect(page.partial).toBe(true);
  });

  it("eligibility=false when no continueWatching capability provider exists", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValue: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValue(false);
    expect(await provider.eligibility(ctx)).toBe(false);
  });
});
