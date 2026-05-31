import type { MediaType } from "@ent-mcp/shared/media";
import * as m from "@/paraglide/messages";
import type { LibraryLens, LibraryStats, WatchedState } from "./types";

/** Localized label functions for the feature's enums (skill rule 9). */
export const lensLabel = (lens: LibraryLens): string => m.library_lens_label({ lens });
export const lensNote = (lens: LibraryLens): string => m.library_lens_note({ lens });
export const watchedLabel = (state: WatchedState): string => m.library_watched({ state });
export const kindLabel = (kind: MediaType): string => m.library_kind({ kind });
export const statLabel = (stat: keyof LibraryStats): string => m.library_stat_label({ stat });
export const facetSectionLabel = (
  facet: "kind" | "genre" | "quality" | "server" | "watched",
): string => m.library_filter_section({ facet });
