import type { LibraryLens, WatchedState } from "@ent-mcp/shared/library";
import type { MediaType } from "@ent-mcp/shared/media";
import * as m from "@/paraglide/messages";

/** Localized label functions for the feature's enums (skill rule 9). */
export const lensLabel = (lens: LibraryLens): string => m.library_lens_label({ lens });
export const lensNote = (lens: LibraryLens): string => m.library_lens_note({ lens });
export const watchedLabel = (state: WatchedState): string => m.library_watched({ state });
export const kindLabel = (kind: MediaType): string => m.media_kind({ kind });
export const facetSectionLabel = (
  facet: "kind" | "genre" | "quality" | "server" | "watched",
): string => m.library_filter_section({ facet });

/**
 * Resolve a stable timeline section key to its display label. `section-groups`
 * emits an i18n-free key — `"unknown"` for yearless titles or the decade's lead
 * year (e.g. `"2020"`) — so this is the single render-boundary seam that turns
 * the key into localized text: the `library_timeline_unknown` message for the
 * yearless bucket, and `${decade}s` (e.g. "2020s") for a decade. Keeping the key
 * locale-free lets grouping, scroll-spy, and anchors compare keys without a
 * locale dependency while the visible header still localizes.
 */
export const timelineSectionLabel = (key: string): string =>
  key === "unknown" ? m.library_timeline_unknown() : `${key}s`;
