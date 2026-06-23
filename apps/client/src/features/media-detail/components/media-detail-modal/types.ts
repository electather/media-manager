import type { CompactMediaItem, MediaDetailsExtra } from "@nama/shared/home";

/** Wire format + optional details from `/api/media/:type/:tmdbId/details`. Episode/season scaffolding removed (request-flow loads directly, PR6). */
export type MediaDetailItem = CompactMediaItem &
  Partial<MediaDetailsExtra> & {
    clearLogoText?: string;
  };
