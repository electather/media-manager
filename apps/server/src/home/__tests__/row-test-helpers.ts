import { vi } from "vite-plus/test";
import type { RowContext } from "../internal/types";

/**
 * Lightweight RowContext stub. Tests pass partial overrides via the `ctx`
 * factory and inspect the resulting calls on the spy fns. Defaults all
 * service methods to no-op rejections so an unmocked path fails loud.
 */
export function makeRowCtx(overrides: Partial<RowContext> = {}): RowContext {
  const mediaService = {
    hasCapabilityProvider: vi.fn().mockResolvedValue(true),
    getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getWatchlistFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getUpcomingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getSimilarFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getStatusBatch: vi.fn().mockResolvedValue({}),
    getMatchingServers: vi.fn().mockResolvedValue([]),
  } as unknown as RowContext["mediaService"];
  const catalog = {
    getRecommendations: vi.fn().mockResolvedValue(null),
    getMetadataBatch: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockResolvedValue(null),
    getDiscoverFeed: vi.fn().mockResolvedValue(null),
    hasDiscoverFeed: vi.fn().mockResolvedValue(false),
    getUserHistory: vi.fn().mockResolvedValue([]),
    getUserRatings: vi.fn().mockResolvedValue([]),
  } as unknown as RowContext["catalog"];
  const statusBatch = {
    get: vi.fn().mockResolvedValue({}),
  } as unknown as RowContext["statusBatch"];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as RowContext["logger"];
  return {
    userId: "u1",
    mediaService,
    catalog,
    statusBatch,
    logger,
    ...overrides,
  };
}

export function libraryItem(opts: {
  tmdbId: string;
  type?: "movie" | "show" | "episode";
  title?: string;
  durationSec?: number;
  season?: number;
  episode?: number;
}) {
  return {
    id: `srv:${opts.tmdbId}`,
    title: opts.title ?? `Title ${opts.tmdbId}`,
    type: opts.type ?? "movie",
    quality: {},
    playerLink: "x://",
    addedAt: "2026-01-01T00:00:00Z",
    durationSec: opts.durationSec,
    season: opts.season,
    episode: opts.episode,
    ids: { tmdb: opts.tmdbId },
  };
}
