import * as m from "@/paraglide/messages";
import { RouteTab, RouteTabs } from "@/shared/components/route-tabs";
import { lensLabel, lensNote } from "../lib/labels";
import { LIBRARY_LENSES, type LibraryLens } from "../lib/types";

/** Each lens is its own route; A→Z is the index. Order mirrors `LIBRARY_LENSES`. */
const LENS_TO = {
  az: "/library",
  timeline: "/library/timeline",
  collections: "/library/collections",
  server: "/library/server",
  quality: "/library/quality",
} as const satisfies Record<LibraryLens, string>;

/**
 * The lens switcher — each tab is a `<RouteTab>` into the lens's sub-route. The
 * `search` reducer carries the active filters across a lens switch, and the
 * active tab is derived from the router's `data-status=active` attribute so it
 * stays in sync with deep links. Built on the shared `RouteTabs` so it reads
 * identically to the watchlist bucket filter.
 */
export function LibraryLensTabs() {
  return (
    <RouteTabs aria-label={m.library_lens_tabs_label()}>
      {LIBRARY_LENSES.map((lens) => (
        <RouteTab
          key={lens}
          to={LENS_TO[lens]}
          // Carry only the filter axes across a lens switch. Keep this list in
          // step with `librarySearchSchema` — a new axis added there must be
          // added here too or it silently won't survive a lens change. (A codec
          // round-trip would cover this automatically, but TanStack's search
          // reducer typing rejects the helper's return — so it's a manual list.)
          search={(prev) => ({
            kinds: prev.kinds,
            genres: prev.genres,
            qualities: prev.qualities,
            servers: prev.servers,
            watched: prev.watched,
          })}
          title={lensLabel(lens)}
          subtitle={lensNote(lens)}
        />
      ))}
    </RouteTabs>
  );
}
