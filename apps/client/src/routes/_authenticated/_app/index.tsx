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

const UPCOMING_SIDEBAR_LIMIT = 4;
const SIDEBAR_ROW: RowKind = "upcomingForYou";

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
  const upcomingRow = layout?.rows.find((row) => row.rowId === SIDEBAR_ROW);
  const mainRows = layout?.rows.filter((row) => row.rowId !== SIDEBAR_ROW) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-350 flex-col gap-12 py-10">
      {heroItem && (
        <TopZone
          heroId={heroItem.id}
          heroSource={layout?.hero?.source ?? null}
          upcomingTitle={upcomingRow?.title ?? null}
        />
      )}
      {mainRows.map((row) => (
        <HomeRowContainer key={row.rowId} rowId={row.rowId} title={row.title} />
      ))}
    </div>
  );
}

function TopZone({
  heroId,
  heroSource,
  upcomingTitle,
}: {
  heroId: string;
  heroSource: RowKind | null;
  upcomingTitle: string | null;
}) {
  const { items: upcomingItems } = useHomeRow(SIDEBAR_ROW);
  const topUpcoming = useMemo(
    () => (upcomingItems as MediaCardItem[]).slice(0, UPCOMING_SIDEBAR_LIMIT),
    [upcomingItems],
  );
  const hasUpcoming = upcomingTitle != null && topUpcoming.length > 0;
  const heroLabel = heroSource === "continueWatching" ? "Continue watching" : "Featured";

  return (
    <div
      data-has-upcoming={hasUpcoming ? "true" : "false"}
      className="grid gap-6 data-[has-upcoming=true]:lg:grid-cols-[3fr_1fr]"
    >
      <div className="flex flex-col gap-2.5">
        <h2 className="text-base ms-6 font-semibold tracking-tight text-foreground">{heroLabel}</h2>
        <HeroBanner mediaId={heroId} />
      </div>
      {hasUpcoming && <UpcomingSidebar title={upcomingTitle} items={topUpcoming} />}
    </div>
  );
}

function HeroBanner({ mediaId }: { mediaId: string }) {
  const item = useMediaRow(mediaId);
  const { openPeek } = usePeek();
  const { watchlist, toggleWatchlist } = useDetailStore();
  if (!item) return null;
  return (
    <MediaCard
      item={item as MediaCardItem}
      isHero
      forceAspect="16/9"
      inWatchlist={watchlist.has(item.id)}
      onPeek={openPeek}
      onToggleWatchlist={toggleWatchlist}
    />
  );
}

function UpcomingSidebar({ title, items }: { title: string; items: readonly MediaCardItem[] }) {
  const { openPeek } = usePeek();
  const { watchlist, toggleWatchlist } = useDetailStore();
  return (
    <section className="flex flex-col gap-2">
      <header className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <MediaCard
              item={item}
              forceLayout="thumb"
              inWatchlist={watchlist.has(item.id)}
              onPeek={openPeek}
              onToggleWatchlist={toggleWatchlist}
            />
          </li>
        ))}
      </ul>
    </section>
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
