import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import type { LibraryCollection, LibraryItem } from "../../lib/types";

interface CollectionsLensProps {
  items: LibraryItem[];
  collections: LibraryCollection[];
}

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

function PosterFan({ posters, title }: { posters: LibraryItem[]; title: string }) {
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

function CollectionCard({
  collection,
  lookup,
  index,
}: {
  collection: LibraryCollection;
  lookup: Map<string, LibraryItem>;
  index: number;
}) {
  const posters = collection.itemIds
    .map((id) => lookup.get(id))
    .filter((item): item is LibraryItem => Boolean(item))
    .slice(0, 4);

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
          {m.library_section_count({ count: String(collection.itemIds.length) })}
        </span>
      </div>
    </article>
  );
}

/**
 * Curated collections: each card fans the first few posters of its set into an
 * arc that expands on hover. Collections whose every item is filtered out are
 * hidden.
 */
export function CollectionsLens({ items, collections }: CollectionsLensProps) {
  const lookup = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visible = useMemo(
    () => collections.filter((collection) => collection.itemIds.some((id) => lookup.has(id))),
    [collections, lookup],
  );

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((collection, index) => (
        <CollectionCard key={collection.id} collection={collection} lookup={lookup} index={index} />
      ))}
    </div>
  );
}
