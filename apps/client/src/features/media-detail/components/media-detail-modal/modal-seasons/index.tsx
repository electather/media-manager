import { Suspense } from "react";
import * as m from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import type { MediaDetailItem } from "../types";
import { SeasonsError } from "./seasons-error";
import { SeasonsList } from "./seasons-list";

/**
 * TV detail modal seasons section. Renders the canonical season list plus
 * per-server availability via a Suspense-scoped fetch — the rest of the
 * modal renders immediately while this section streams in. ErrorBoundary
 * scoped tightly so a season-availability fetch failure does not blank the
 * whole modal.
 */
export function ModalSeasons({ item }: { item: MediaDetailItem }) {
  if (item.mediaType !== "tv" || !item.seasons || item.seasons.length === 0) return null;
  return (
    <section
      aria-label={m.home_detail_seasons_label()}
      className="flex flex-col gap-2 px-6 sm:px-10"
    >
      <ErrorBoundary fallback={() => <SeasonsError />}>
        <Suspense fallback={<SeasonsSkeleton />}>
          <SeasonsList tmdbId={item.tmdbId} itemTitle={item.title} seasons={item.seasons} />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}

function SeasonsSkeleton() {
  return (
    <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      {m.home_detail_seasons_loading()}
    </p>
  );
}
