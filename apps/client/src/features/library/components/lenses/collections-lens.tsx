import { useCallback } from "react";
import type { LibraryCollection } from "@nama/shared/library";
import type { CompactMediaItem } from "@nama/shared/media";
import * as m from "@/paraglide/messages";
import { PaginationSlot, usePaginationSlot, VirtualGrid } from "@/shared/components/virtualized";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

interface CollectionsLensProps {
  collections: LibraryCollection[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  /** Next-page rejection (initial load throws to the boundary); drives the trailing retry (#888). */
  error: Error | null;
}

// Card grid geometry — wider cards than the poster lenses (each card fans a
// franchise), mirroring the prior `sm:grid-cols-2 xl:grid-cols-3` auto layout.
const MIN_COLUMN_PX = 320;
const GAP_PX = 20;
const EST_ROW_HEIGHT = 320;

/**
 * Per-index choreography for the fanned poster arc. Each poster pivots from its
 * bottom edge (`origin-bottom`), so rotation alone splays the tops into an arc;
 * on hover the rotation widens, the overlap loosens, and the inner posters lift
 * highest to crest the arc. Staggered `delay` values open the fan from the
 * centre outward — like a hand of cards being dealt.
 */
const FAN = [
  {
    rest: "-rotate-[15deg]",
    hover: "group-hover:-rotate-[31deg] group-hover:-translate-y-1",
    delay: 120,
  },
  {
    rest: "-rotate-[5deg]",
    hover: "group-hover:-rotate-[11deg] group-hover:-translate-y-3",
    delay: 40,
  },
  {
    rest: "rotate-[5deg]",
    hover: "group-hover:rotate-[11deg] group-hover:-translate-y-3",
    delay: 40,
  },
  {
    rest: "rotate-[15deg]",
    hover: "group-hover:rotate-[31deg] group-hover:-translate-y-1",
    delay: 120,
  },
];

function PosterFan({ posters, title }: { posters: CompactMediaItem[]; title: string }) {
  return (
    <div
      className="relative flex justify-center py-7 [perspective:1200px]"
      aria-hidden="true"
      title={title}
    >
      {/* Footlight: an amber pool that warms up beneath the fan on hover. */}
      <span className="pointer-events-none absolute bottom-3 left-1/2 h-20 w-3/4 -translate-x-1/2 rounded-[100%] bg-primary/0 blur-2xl transition-colors duration-500 group-hover:bg-primary/25" />
      {posters.map((item, index) => {
        const fan = FAN[index] ?? FAN[FAN.length - 1]!;
        return (
          <div
            key={item.id}
            className={cn(
              "relative aspect-[2/3] w-28 origin-bottom overflow-hidden rounded-lg border border-border/60 bg-muted shadow-lg ring-1 ring-black/5",
              "transition-[transform,margin,box-shadow] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:shadow-2xl",
              index > 0 && "-ms-12 group-hover:-ms-4",
              fan.rest,
              fan.hover,
            )}
            style={{ transitionDelay: `${fan.delay}ms` }}
          >
            {item.poster ? (
              <img src={item.poster} alt="" className="size-full object-cover" loading="lazy" />
            ) : null}
            {/* Edge sheen separates stacked posters and lends them depth. */}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-white/10" />
          </div>
        );
      })}
    </div>
  );
}

function CollectionCard({ collection, index }: { collection: LibraryCollection; index: number }) {
  // The endpoint already returns up to four enriched preview items (sorted by
  // sortTitle, id) so the fan reads `collection.preview` directly — no second
  // fetch and no client-side lookup against the loaded item set.
  const posters = collection.preview.slice(0, 4);

  // Intentionally inert for this pass: the card carries hover affordance but no
  // click target yet. Collection drill-down (a pre-filtered `/library` view) is
  // out of scope here and lands with the collections detail route — don't wire a
  // half-finished handler onto the hover state.
  return (
    <article
      className={cn(
        "group relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 p-4",
        "bg-gradient-to-b from-card to-card/55 shadow-sm",
        "transition-[transform,border-color,box-shadow] duration-500 ease-out",
        "hover:z-10 hover:-translate-y-1 hover:border-primary/40 hover:shadow-hero",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-backwards",
      )}
      style={{ animationDelay: `${index * 70}ms`, animationDuration: "550ms" }}
    >
      {/* Top spotlight: faint atmosphere at rest, brightening on hover. */}
      <span className="pointer-events-none absolute -top-20 left-1/2 -z-10 h-40 w-40 -translate-x-1/2 rounded-full bg-primary/5 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />
      <PosterFan posters={posters} title={collection.title} />
      <div className="flex items-baseline justify-between gap-2 border-t border-border/50 pt-3">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {collection.title}
        </h3>
        <span className="shrink-0 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
          {/* The franchise's full owned size from the server, not the fanned
              preview subset — the badge stays stable as the fan only shows the
              first few posters. */}
          {m.library_section_count({ count: String(collection.count) })}
        </span>
      </div>
    </article>
  );
}

/**
 * Curated collections: each card fans its server-supplied `preview` posters into
 * an arc that expands on hover. The endpoint is group-first and filter-aware, so
 * this lens just renders the cards (no client filtering or lookup) and paginates
 * the group stream through the shared `VirtualGrid` — `onEndReached` fetches the
 * next cursor, guarded by `hasNextPage && !isFetchingNextPage`.
 */
export function CollectionsLens({
  collections,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  error,
}: CollectionsLensProps) {
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const slot = usePaginationSlot({
    itemCount: collections.length,
    hasNextPage,
    isFetchingNextPage,
    error,
    fetchNextPage,
  });

  return (
    <div className="flex flex-col gap-8">
      <VirtualGrid
        items={collections}
        getKey={(collection) => collection.id}
        minColumnWidthPx={MIN_COLUMN_PX}
        gapPx={GAP_PX}
        estimateRowHeight={() => EST_ROW_HEIGHT}
        renderItem={(collection, index) => <CollectionCard collection={collection} index={index} />}
        onEndReached={onEndReached}
      />
      {/* Append-error retry (#888); loading stays on the "load more" button. */}
      {slot.state === "error" ? <PaginationSlot slot={slot} variant="row" /> : null}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? m.library_loading_more() : m.library_load_more()}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
