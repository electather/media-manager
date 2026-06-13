// Plugin author API. Every symbol a third-party plugin imports comes through
// this barrel — either owned by the SDK or re-exported from `@nama/shared`.
// The SDK never re-exports from `@nama/server`; host-internal subsystems
// stay on the server.

// ─── Owned by the SDK ─────────────────────────────────────────────────────────
export * from "./types";
export * from "./define";
export * from "./errors/plugin-error";
export * from "./utils/http-status";
export * from "./utils/credentials";
export * from "./capabilities";
export { MetadataV1 } from "./capabilities/metadata";
export { WatchHistoryV1 } from "./capabilities/watch-history";
export { WatchlistV1 } from "./capabilities/watchlist";
export { RatingsV1 } from "./capabilities/ratings";
export { RecommendationsV1 } from "./capabilities/recommendations";
export { CalendarV1 } from "./capabilities/calendar";
export { MediaRequestV1 } from "./capabilities/media-request";
export { IdResolveV1 } from "./capabilities/id-resolve";
export type { IdResolveKind } from "./capabilities/id-resolve";
export { UserCommentsV1 } from "./capabilities/user-comments";
export { WatchProvidersV1 } from "./capabilities/watch-providers";
export { TrailersV1 } from "./capabilities/trailers";
export { PlaybackV1 } from "./capabilities/playback";
export { CollectionV1 } from "./capabilities/collection";
export { LibraryAvailabilityV1 } from "./capabilities/library-availability";
export { ContinueWatchingV1 } from "./capabilities/continue-watching";
export type { ContinueWatchingEntry } from "./capabilities/continue-watching";
export { PlaybackSessionsV1 } from "./capabilities/playback-sessions";
export type { SessionEntry } from "./capabilities/playback-sessions";
export { LibraryAdminV1 } from "./capabilities/library-admin";
export { ArtworkV1, artworkV1ManifestExtrasSchema } from "./capabilities/artwork";
export type { ArtworkV1ManifestExtras } from "./capabilities/artwork";
export type { NotificationDeliveryCapabilityV1 } from "./capabilities/notification-delivery";
export type { MediaItemShape } from "./capabilities/shared-schemas";
export * from "./validate";
export * from "./version";

// ─── Re-exported from @nama/shared so plugin authors only need one dep ─────
export {
  pluginManifestSchema,
  manifestCapabilitySchema,
  manifestJobEntrySchema,
  authKindSchema,
  capabilityScopeSchema,
} from "@nama/shared/plugins";
export type {
  PluginManifest,
  ManifestCapability,
  ManifestJobEntry,
  McpToolDefinition,
  McpToolAnnotations,
  AuthKind,
  CapabilityScope,
} from "@nama/shared/plugins";
export type { JSONSchema } from "@nama/shared/common";
export type { HostErrorCode } from "@nama/shared/diagnostics";
export {
  artworkVariantSchema,
  artworkBundleSchema,
  artworkIdMapSchema,
  artworkRequestItemSchema,
  artworkErrorSchema,
  artworkGetResponseSchema,
  ARTWORK_KINDS,
  ARTWORK_ID_TYPES,
  ARTWORK_ERROR_CODES,
  MAX_VARIANTS_PER_KIND,
} from "@nama/shared/artwork";
export type {
  ArtworkVariant,
  ArtworkBundle,
  ArtworkIdMap,
  ArtworkRequestItem,
  ArtworkError,
  ArtworkGetResponse,
  ArtworkKind,
  ArtworkIdType,
  ArtworkErrorCode,
} from "@nama/shared/artwork";
export {
  libraryItemSchema,
  libraryItemQualitySchema,
  LIBRARY_ITEM_TYPES,
  LIBRARY_ITEM_QUERY_TYPES,
  LIBRARY_ITEM_RESOLUTIONS,
  LIBRARY_ITEM_HDR_FORMATS,
} from "@nama/shared/plugins/library";
export type {
  LibraryItem,
  LibraryItemType,
  LibraryItemQueryType,
  LibraryItemResolution,
  LibraryItemHdrFormat,
  LibraryItemQuality,
} from "@nama/shared/plugins/library";
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_CONTENT_KINDS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CATEGORY_PERMISSION,
} from "@nama/shared/notifications";
export type {
  BaseEvent,
  NotificationCategory,
  NotificationSeverity,
  NotificationDeliveryStatus,
  NotificationContentKind,
  NotificationEventType,
  NotificationAudience,
  NotificationEventEnvelope,
  NotificationAction,
  NotificationMessage,
  NotificationEvent,
} from "@nama/shared/notifications";
