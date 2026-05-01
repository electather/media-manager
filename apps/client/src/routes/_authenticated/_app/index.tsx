import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { RowKind } from "@ent-mcp/shared/home";
import { useHomeLayout, useHomeRow, useMediaRow, loadRowPage, usePeek } from "@/features/media";
import { MediaCard, type MediaCardItem } from "@/features/media/components/media-card";
import { MediaRow } from "@/shared/components/media-row";
import { useDetailStore } from "@/features/media/lib/use-detail-store";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomePage,
});

const ROW_ASPECT: Partial<Record<RowKind, "16/9" | "2/3">> = {
  continueWatching: "16/9",
  upcomingForYou: "16/9",
  trendingNow: "2/3",
  newReleases: "2/3",
  recommendedForYou: "2/3",
  becauseYouWatched: "2/3",
  yourWatchlist: "2/3",
};

function HomePage() {
  const { layout } = useHomeLayout();
  const heroItem = useMediaRow(layout?.hero?.item.id ?? null);

  return (
    <div className="mx-auto flex w-full max-w-350 flex-col gap-12 py-10">
      {heroItem && <HeroBanner mediaId={heroItem.id} />}
      {layout?.rows.map((row) => (
        <HomeRowContainer key={row.rowId} rowId={row.rowId} title={row.title} />
      ))}
    </div>
  );
}

function HeroBanner({ mediaId }: { mediaId: string }) {
  const item = useMediaRow(mediaId);
  const { openPeek } = usePeek();
  const { watchlist, toggleWatchlist } = useDetailStore();
  if (!item) return null;
  return (
    <div className="-mx-4 mb-2">
      <MediaCard
        item={item as MediaCardItem}
        isHero
        forceAspect="16/9"
        inWatchlist={watchlist.has(item.id)}
        onPeek={openPeek}
        onToggleWatchlist={toggleWatchlist}
      />
    </div>
  );
}

function HomeRowContainer({ rowId, title }: { rowId: RowKind; title: string }) {
  const { items, isLoading } = useHomeRow(rowId);
  const aspect = ROW_ASPECT[rowId] ?? "2/3";
  const { openPeek } = usePeek();
  const { watchlist, toggleWatchlist } = useDetailStore();

  const renderItem = useMemo(() => {
    return (item: MediaCardItem) => (
      <MediaCard
        item={item}
        forceAspect={aspect}
        inWatchlist={watchlist.has(item.id)}
        onPeek={openPeek}
        onToggleWatchlist={toggleWatchlist}
      />
    );
  }, [aspect, watchlist, openPeek, toggleWatchlist]);

  const handleLoadMore = useCallback(() => {
    void loadRowPage(rowId);
  }, [rowId]);

  return (
    <MediaRow
      title={title}
      items={items as MediaCardItem[]}
      defaultAspect={aspect}
      isLoading={isLoading}
      hasMore
      onLoadMore={handleLoadMore}
      renderItem={renderItem}
    />
  );
}
