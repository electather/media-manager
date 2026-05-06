import * as m from "@/paraglide/messages";
import type { MediaDetailItem } from "./types";

/**
 * Placeholder seasons section. The TV season / episode payload is owned by
 * the request-flow feature post-PR6; the modal stops carrying `seasons[]`
 * so the request flow can fetch the rich shape on demand. Until that
 * fetcher lands the modal renders a one-line hint for TV titles.
 */
export function ModalSeasons({ item }: { item: MediaDetailItem }) {
  if (item.mediaType !== "tv") return null;
  return (
    <section
      aria-label={m.home_detail_seasons_label()}
      className="flex flex-col gap-2 px-6 sm:px-10"
    >
      <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        {m.home_detail_seasons_placeholder()}
      </p>
    </section>
  );
}
