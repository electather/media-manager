import type { CompactMediaItem, MediaDetailsExtra } from "@ent-mcp/shared/home";

/**
 * Detail-modal item shape. `CompactMediaItem` is the wire format from
 * `@ent-mcp/shared/home`; `MediaDetailsExtra` carries the layered fields
 * the dedicated `/api/home/details` endpoint returns (cast, director, etc).
 * Episode / season scaffolding owned by the request-flow feature is no
 * longer carried on the modal — request flow loads it directly when the
 * picker opens (see `feature-home-page-backend-1.md` PR6).
 */
export type MediaDetailItem = CompactMediaItem &
  Partial<MediaDetailsExtra> & {
    clearLogoText?: string;
  };
