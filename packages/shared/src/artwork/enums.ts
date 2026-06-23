/**
 * Asset kinds returned in an `ArtworkBundle`. Keep aligned with the per-kind
 * fields on the bundle so the dispatcher's `aggregate_per_kind` strategy can
 * loop over this tuple instead of hard-coding the field list.
 */
export const ARTWORK_KINDS = ["poster", "backdrop", "clearLogo", "thumb"] as const;
export type ArtworkKind = (typeof ARTWORK_KINDS)[number];

/**
 * Maximum variants per asset kind, enforced in bundle schema and used by plugin authors.
 * Single source of truth for raising the cap.
 */
export const MAX_VARIANTS_PER_KIND = 5;

/**
 * Id types accepted on the `getArtwork` request map. Each provider declares
 * which subset it can serve per media type via `manifestSpec.supportedIdTypes`.
 */
export const ARTWORK_ID_TYPES = ["tmdb", "imdb", "tvdb"] as const;
export type ArtworkIdType = (typeof ARTWORK_ID_TYPES)[number];

/**
 * Per-item error code returned by the `artwork.get` RPC. Top-level RPC stays
 * 200 even when individual items fail.
 */
export const ARTWORK_ERROR_CODES = ["unsupported_id_combo", "internal"] as const;
export type ArtworkErrorCode = (typeof ARTWORK_ERROR_CODES)[number];
