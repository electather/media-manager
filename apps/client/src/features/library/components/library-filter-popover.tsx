import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  WATCHED_STATES,
  type LibraryFacetCounts,
  type WatchedState,
} from "@ent-mcp/shared/library";
import type { MediaType } from "@ent-mcp/shared/media";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { countActiveFilters } from "../lib/filtering";
import { facetSectionLabel, kindLabel, watchedLabel } from "../lib/labels";
import { EMPTY_FILTERS, type LibraryFilters } from "../lib/types";

const KINDS: MediaType[] = ["movie", "tv"];

interface LibraryFilterPopoverProps {
  filters: LibraryFilters;
  facetValues: { genres: string[]; qualities: string[]; servers: string[] };
  /** Whole-library facet totals; undefined until the non-blocking facets read lands. */
  facetCounts: LibraryFacetCounts | undefined;
  onChange: (filters: LibraryFilters) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground/80">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The match-count badge trailing a facet option; brightens with the pressed pill. */
function FacetCount({ value }: { value?: number }) {
  if (value == null) return null;
  return (
    <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground/60 [[data-pressed]_&]:text-primary-foreground/70">
      {value}
    </span>
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
            <ToggleGroup<MediaType>
              multiple
              value={filters.kinds}
              onValueChange={(next) => set("kinds", next)}
            >
              {KINDS.map((kind) => (
                <ToggleGroupItem<MediaType> key={kind} value={kind} variant="primary">
                  {kindLabel(kind)}
                  <FacetCount value={facetCounts?.kinds[kind]} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section title={facetSectionLabel("watched")}>
            <ToggleGroup<WatchedState>
              multiple
              value={filters.watched}
              onValueChange={(next) => set("watched", next)}
            >
              {WATCHED_STATES.map((state: WatchedState) => (
                <ToggleGroupItem<WatchedState> key={state} value={state} variant="primary">
                  {watchedLabel(state)}
                  <FacetCount value={facetCounts?.watched[state]} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section title={facetSectionLabel("genre")}>
            <ToggleGroup
              multiple
              value={filters.genres}
              onValueChange={(next) => set("genres", next)}
            >
              {facetValues.genres.map((genre) => (
                <ToggleGroupItem key={genre} value={genre} variant="primary">
                  {genre}
                  <FacetCount value={facetCounts?.genres[genre]} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section title={facetSectionLabel("quality")}>
            <ToggleGroup
              multiple
              value={filters.qualities}
              onValueChange={(next) => set("qualities", next)}
            >
              {facetValues.qualities.map((quality) => (
                <ToggleGroupItem key={quality} value={quality} variant="primary">
                  {quality}
                  <FacetCount value={facetCounts?.qualities[quality]} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section title={facetSectionLabel("server")}>
            <ToggleGroup
              multiple
              value={filters.servers}
              onValueChange={(next) => set("servers", next)}
            >
              {facetValues.servers.map((server) => (
                <ToggleGroupItem key={server} value={server} variant="primary">
                  {server}
                  <FacetCount value={facetCounts?.servers[server]} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>
        </div>

        <footer className="flex justify-end border-t px-4 py-3">
          <PopoverClose render={<Button size="sm">{m.library_filter_done()}</Button>} />
        </footer>
      </PopoverContent>
    </Popover>
  );
}
