import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { MediaType } from "@ent-mcp/shared/media";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { countActiveFilters } from "../lib/filtering";
import { facetSectionLabel, kindLabel, watchedLabel } from "../lib/labels";
import {
  EMPTY_FILTERS,
  WATCHED_STATES,
  type LibraryFacetCounts,
  type LibraryFilters,
  type WatchedState,
} from "../lib/types";
import { LibraryFacetPill } from "./library-facet-pill";

const KINDS: MediaType[] = ["movie", "tv"];

interface LibraryFilterPopoverProps {
  filters: LibraryFilters;
  facetValues: { genres: string[]; qualities: string[]; servers: string[] };
  facetCounts: LibraryFacetCounts;
  onChange: (filters: LibraryFilters) => void;
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground/80">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

/**
 * The faceted filter popover. The trigger doubles as the count badge; toggling
 * any pill patches one axis of the page's `filters` state, which re-derives the
 * visible item set. Counts come from the full catalog so they stay stable.
 */
export function LibraryFilterPopover({
  filters,
  facetValues,
  facetCounts,
  onChange,
}: LibraryFilterPopoverProps) {
  const activeCount = countActiveFilters(filters);
  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="rounded-full">
            <SlidersHorizontal aria-hidden="true" />
            {m.library_filter_toggle()}
            {activeCount > 0 ? (
              <Badge variant="default" className="ms-0.5 px-1.5 font-mono tabular-nums">
                {activeCount}
              </Badge>
            ) : null}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="flex max-h-[min(34rem,70vh)] w-[min(40rem,calc(100vw-2rem))] flex-col p-0"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">{m.library_filter_heading()}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={activeCount === 0}
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            {m.library_filter_clear_all()}
          </Button>
        </header>

        <div className="grid grid-cols-1 gap-5 overflow-y-auto p-4 sm:grid-cols-2">
          <Section title={facetSectionLabel("kind")}>
            {KINDS.map((kind) => (
              <LibraryFacetPill
                key={kind}
                label={kindLabel(kind)}
                count={facetCounts.kinds[kind]}
                active={filters.kinds.includes(kind)}
                onToggle={() => set("kinds", toggle(filters.kinds, kind))}
              />
            ))}
          </Section>

          <Section title={facetSectionLabel("watched")}>
            {WATCHED_STATES.map((state: WatchedState) => (
              <LibraryFacetPill
                key={state}
                label={watchedLabel(state)}
                count={facetCounts.watched[state]}
                active={filters.watched.includes(state)}
                onToggle={() => set("watched", toggle(filters.watched, state))}
              />
            ))}
          </Section>

          <Section title={facetSectionLabel("genre")}>
            {facetValues.genres.map((genre) => (
              <LibraryFacetPill
                key={genre}
                label={genre}
                count={facetCounts.genres[genre]}
                active={filters.genres.includes(genre)}
                onToggle={() => set("genres", toggle(filters.genres, genre))}
              />
            ))}
          </Section>

          <Section title={facetSectionLabel("quality")}>
            {facetValues.qualities.map((quality) => (
              <LibraryFacetPill
                key={quality}
                label={quality}
                count={facetCounts.qualities[quality]}
                active={filters.qualities.includes(quality)}
                onToggle={() => set("qualities", toggle(filters.qualities, quality))}
              />
            ))}
          </Section>

          <Section title={facetSectionLabel("server")}>
            {facetValues.servers.map((server) => (
              <LibraryFacetPill
                key={server}
                label={server}
                count={facetCounts.servers[server]}
                active={filters.servers.includes(server)}
                onToggle={() => set("servers", toggle(filters.servers, server))}
              />
            ))}
          </Section>
        </div>

        <footer className="flex justify-end border-t px-4 py-3">
          <PopoverClose render={<Button size="sm">{m.library_filter_done()}</Button>} />
        </footer>
      </PopoverContent>
    </Popover>
  );
}
