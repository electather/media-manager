import type { CompactMediaItem, MediaDetailsExtra } from "@nama/shared/home";

/**
 * Detail-modal item shape. `CompactMediaItem` is the wire format from
 * `@nama/shared/home`; `MediaDetailsExtra` carries the layered fields
 * the `/api/media/:type/:tmdbId/details` endpoint returns (cast, director, etc).
 * Episode / season scaffolding owned by the request-flow feature is no
 * longer carried on the modal — request flow loads it directly when the
 * picker opens (see `feature-home-page-backend-1.md` PR6).
 */
export type MediaDetailItem = CompactMediaItem &
  Partial<MediaDetailsExtra> & {
    clearLogoText?: string;
  };
