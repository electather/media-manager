import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { MediaCard, type MediaCardItem } from "@/shared/components/media-card";
import { MediaRow } from "@/shared/components/media-row";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomeMockPage,
});

const PLACEHOLDER_BACKDROP = "https://images.unsplash.com/photo-1542204625-ca960ad6dd64?w=800";
const PLACEHOLDER_POSTER = "https://images.unsplash.com/photo-1535016120720-40c646be5580?w=400";

const TITLES = [
  "The Bear",
  "Shogun",
  "True Detective",
  "Fallout",
  "House of the Dragon",
  "Andor",
  "Slow Horses",
  "The Last of Us",
  "Foundation",
  "Mr. Robot",
  "Better Call Saul",
  "Succession",
  "Mindhunter",
  "Dark",
  "Chernobyl",
  "Fargo",
];

const STATUS_VALUES: NonNullable<CompactMediaItem["status"]>[] = [
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
];

const CONTINUE_WATCHING: MediaCardItem[] = [
  {
    id: "movie:1",
    tmdbId: "1",
    mediaType: "movie",
    title: "Dune: Part Two",
    year: 2024,
    backdrop: PLACEHOLDER_BACKDROP,
    progress: { watched: 4200, total: 9600 },
  },
  {
    id: "tv:2",
    tmdbId: "2",
    mediaType: "tv",
    title: "Severance",
    year: 2025,
    backdrop: PLACEHOLDER_BACKDROP,
    progress: { watched: 1500, total: 3000 },
    episodeProgress: { watched: 4, total: 10 },
  },
  ...mockBackdropSeries("cw", 8, { hasProgress: true }),
];

const TRENDING_NOW: MediaCardItem[] = mockPosterSeries("trend", 14, { hasStatus: true });
const NEW_RELEASES: MediaCardItem[] = mockPosterSeries("new", 12, {});
const UPCOMING: MediaCardItem[] = mockUpcoming(10);

function HomeMockPage() {
  const [watchlist, setWatchlist] = useState<ReadonlySet<string>>(new Set());
  const handlePeek = useCallback((id: string) => {
    console.info("[mock] open peek", id);
  }, []);
  const handleToggleWatchlist = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const continueRow = useMockPaginatedRow(CONTINUE_WATCHING, "16/9");
  const trendingRow = useMockPaginatedRow(TRENDING_NOW, "2/3");
  const newReleasesRow = useMockPaginatedRow(NEW_RELEASES, "2/3");
  const upcomingRow = useMockPaginatedRow(UPCOMING, "16/9");

  const renderBackdrop = useMemo(
    () => makeRenderCard("16/9", watchlist, handlePeek, handleToggleWatchlist),
    [watchlist, handlePeek, handleToggleWatchlist],
  );
  const renderPoster = useMemo(
    () => makeRenderCard("2/3", watchlist, handlePeek, handleToggleWatchlist),
    [watchlist, handlePeek, handleToggleWatchlist],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-12 px-6 py-10">
      <MediaRow
        title="Continue Watching"
        items={continueRow.items}
        defaultAspect="16/9"
        isLoading={continueRow.isLoading}
        hasMore={continueRow.hasMore}
        onLoadMore={continueRow.loadMore}
        renderItem={renderBackdrop}
      />
      <MediaRow
        title="Trending Now"
        items={trendingRow.items}
        defaultAspect="2/3"
        isLoading={trendingRow.isLoading}
        hasMore={trendingRow.hasMore}
        partial
        onLoadMore={trendingRow.loadMore}
        renderItem={renderPoster}
      />
      <MediaRow
        title="New Releases"
        items={newReleasesRow.items}
        defaultAspect="2/3"
        isLoading={newReleasesRow.isLoading}
        hasMore={newReleasesRow.hasMore}
        onLoadMore={newReleasesRow.loadMore}
        renderItem={renderPoster}
      />
      <MediaRow
        title="Upcoming For You"
        items={upcomingRow.items}
        defaultAspect="16/9"
        isLoading={upcomingRow.isLoading}
        hasMore={upcomingRow.hasMore}
        onLoadMore={upcomingRow.loadMore}
        renderItem={renderBackdrop}
      />
    </div>
  );
}

type Aspect = "16/9" | "2/3";

function makeRenderCard(
  aspect: Aspect,
  watchlist: ReadonlySet<string>,
  onPeek: (id: string) => void,
  onToggleWatchlist: (id: string) => void,
) {
  return (item: MediaCardItem) => (
    <MediaCard
      item={item}
      forceAspect={aspect}
      inWatchlist={watchlist.has(item.id)}
      onPeek={onPeek}
      onToggleWatchlist={onToggleWatchlist}
    />
  );
}

const MOCK_PAGE_SIZE = 8;
const MOCK_FETCH_DELAY_MS = 600;
const MOCK_MAX_PAGES = 4;

type PaginatedRow<TItem> = {
  items: readonly TItem[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

function useMockPaginatedRow(
  seed: readonly MediaCardItem[],
  aspect: Aspect,
): PaginatedRow<MediaCardItem> {
  const [items, setItems] = useState<readonly MediaCardItem[]>(seed);
  const [isLoading, setIsLoading] = useState(false);
  const [pages, setPages] = useState(1);
  const hasMore = pages < MOCK_MAX_PAGES;

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    window.setTimeout(() => {
      const more =
        aspect === "16/9"
          ? mockBackdropSeries(`pg${pages}`, MOCK_PAGE_SIZE, {})
          : mockPosterSeries(`pg${pages}`, MOCK_PAGE_SIZE, {});
      setItems((prev) => [...prev, ...more]);
      setPages((n) => n + 1);
      setIsLoading(false);
    }, MOCK_FETCH_DELAY_MS);
  }, [aspect, hasMore, isLoading, pages]);

  return { items, isLoading, hasMore, loadMore };
}

type MockOptions = {
  hasProgress?: boolean;
  hasStatus?: boolean;
};

function mockBackdropSeries(prefix: string, count: number, opts: MockOptions): MediaCardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}:${i}`,
    tmdbId: `${i}`,
    mediaType: i % 3 === 0 ? "movie" : "tv",
    title: TITLES[i % TITLES.length] ?? `Title ${i}`,
    year: 2020 + (i % 6),
    backdrop: PLACEHOLDER_BACKDROP,
    matchReason: i % 4 === 0 ? "Because you watched Severance" : undefined,
    status: opts.hasStatus ? STATUS_VALUES[i % STATUS_VALUES.length] : undefined,
    progress: opts.hasProgress ? { watched: 1000 + i * 200, total: 5400 } : undefined,
  }));
}

function mockPosterSeries(prefix: string, count: number, opts: MockOptions): MediaCardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}:${i}`,
    tmdbId: `${i}`,
    mediaType: i % 3 === 0 ? "movie" : "tv",
    title: TITLES[i % TITLES.length] ?? `Title ${i}`,
    year: 2020 + (i % 6),
    poster: PLACEHOLDER_POSTER,
    matchReason: i % 4 === 0 ? "Because you watched Severance" : undefined,
    status: opts.hasStatus ? STATUS_VALUES[i % STATUS_VALUES.length] : undefined,
  }));
}

function mockUpcoming(count: number): MediaCardItem[] {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => ({
    id: `upc:${i}`,
    tmdbId: `${100 + i}`,
    mediaType: "tv" as const,
    title: ["The Bear", "Shogun", "Fallout", "House of the Dragon"][i % 4]!,
    year: 2025,
    backdrop: PLACEHOLDER_BACKDROP,
    episode: {
      season: 1 + (i % 3),
      episode: 1 + i,
      airsAt: Date.now() + (i + 1) * oneDayMs,
      name: `Episode ${i + 1}`,
    },
  }));
}
