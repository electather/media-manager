export const BASE = "https://webservice.fanart.tv/v3";

/**
 * Default origin fanart.tv serves CDN assets from. Admins running a proxy in
 * front of fanart override this via the `assetCdnPrefix` global config; the
 * mapper rewrites payload URLs to the override origin before returning.
 */
export const DEFAULT_ASSET_CDN_PREFIX = "https://assets.fanart.tv";

/**
 * Default language preference applied when the caller does not pass
 * `languages` through to the capability. Mirrors the server-side default in
 * `ArtworkService` so a direct plugin invocation produces the same ranking.
 */
export const DEFAULT_LANGUAGES = ["en", "00"] as const;
