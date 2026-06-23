import type { LibraryLens, WatchedState } from "@nama/shared/library";
import type { MediaType } from "@nama/shared/media";
import * as m from "@/paraglide/messages";

/** Localized label functions for the feature's enums (skill rule 9). */
export const lensLabel = (lens: LibraryLens): string => m.library_lens_label({ lens });
export const lensNote = (lens: LibraryLens): string => m.library_lens_note({ lens });
export const watchedLabel = (state: WatchedState): string => m.library_watched({ state });
export const kindLabel = (kind: MediaType): string => m.media_kind({ kind });
export const facetSectionLabel = (
  facet: "kind" | "genre" | "quality" | "server" | "watched",
): string => m.library_filter_section({ facet });

/** Converts i18n-free timeline key ("unknown" or decade year) to localized label; key stays locale-free for grouping/anchors. */
export const timelineSectionLabel = (key: string): string =>
  key === "unknown" ? m.library_timeline_unknown() : `${key}s`;
