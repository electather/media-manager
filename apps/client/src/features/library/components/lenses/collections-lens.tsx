import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import type { LibraryCollection, LibraryItem } from "../../lib/types";

interface CollectionsLensProps {
  items: LibraryItem[];
  collections: LibraryCollection[];
}

/** Per-index rotation for the fanned poster stack on each collection card. */
const FAN_ROTATION = ["-rotate-6", "-rotate-2", "rotate-2", "rotate-6"];

function PosterFan({ posters, title }: { posters: LibraryItem[]; title: string }) {
  return (
    <div className="flex justify-center py-2" aria-hidden="true" title={title}>
      {posters.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            "aspect-[2/3] w-20 overflow-hidden rounded-md border bg-muted shadow-md transition-[margin] duration-500 ease-out",
            index > 0 && "-ms-8 group-hover:-ms-2",
            FAN_ROTATION[index],
          )}
        >
          {item.poster ? (
            <img src={item.poster} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CollectionCard({
  collection,
  lookup,
}: {
  collection: LibraryCollection;
  lookup: Map<string, LibraryItem>;
}) {
  const posters = collection.itemIds
    .map((id) => lookup.get(id))
    .filter((item): item is LibraryItem => Boolean(item))
    .slice(0, 4);

  return (
    <article className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-input">
      <PosterFan posters={posters} title={collection.title} />
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{collection.title}</h3>
        <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground/70">
          {m.library_section_count({ count: String(collection.itemIds.length) })}
        </span>
      </div>
    </article>
  );
}

/**
 * Curated collections: each card fans the first few posters of its set, spreading
 * them on hover. Collections whose every item is filtered out are hidden.
 */
export function CollectionsLens({ items, collections }: CollectionsLensProps) {
  const lookup = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visible = useMemo(
    () => collections.filter((collection) => collection.itemIds.some((id) => lookup.has(id))),
    [collections, lookup],
  );

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} lookup={lookup} />
      ))}
    </div>
  );
}
