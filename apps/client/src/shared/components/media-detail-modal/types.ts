import type { CompactMediaItem } from "@ent-mcp/shared/home";
// TODO: replace these `Mock*` imports with the wire types once the
// detail-fetch endpoint is defined. The shared modal should not depend on
// the home-feature mock layer (per `2026-04-29-frontend-structure-design.md`),
// so when the real episode/season payload lands these types should move to
// `@ent-mcp/shared/home` (or be inlined here) and this import deleted.
import type { MockEpisode, MockSeason } from "@/features/home/lib/types";

export type { MockEpisode as EpisodeData, MockSeason as SeasonData };
export type EpisodeStatus = MockEpisode["status"];

/**
 * Detail-modal item shape. `CompactMediaItem` is the wire format from
 * `@ent-mcp/shared/home`; the optional fields below are display-only
 * scaffolding that the detail-fetch endpoint will populate later. While
 * unset, the corresponding sections (`ModalScores`, `ModalTags`,
 * `ModalCredits`, `ModalSeasons`, `ModalTVAirInfo`) render as no-ops.
 */
export type MediaDetailItem = CompactMediaItem & {
  clearLogoText?: string;
  runtime?: string;
  ageRating?: string;
  cast?: string[];
  director?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  tags?: string[];
  trailerUrl?: string;
  seriesStatus?: "ongoing" | "finished";
  nextAirDate?: string;
  seasons?: MockSeason[];
};
