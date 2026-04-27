import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { MEDIA_TYPES } from "@ent-mcp/shared/media";
import { user } from "./auth";
import {
  DISCOVER_FEED_KINDS,
  DISCOVER_SORTS,
  RECOMMENDATION_LIST_KINDS,
  type CanonicalFeatures,
  type HistoryEvent,
  type MetadataKey,
  type PluginCursors,
  type RatingEvent,
  type RecItem,
} from "../../catalog/types";

export {
  DISCOVER_FEED_KINDS,
  DISCOVER_SORTS,
  RECOMMENDATION_LIST_KINDS,
  type DiscoverFeedKind,
  type DiscoverSort,
  type RecommendationListKind,
} from "../../catalog/types";

// JSON columns store text on disk but carry a richer TS shape.
// `$type<T>()` documents the serialization contract at the schema level so
// drizzle-zod inference and downstream consumers see the parsed type.
export const canonicalMetadata = sqliteTable(
  "canonical_metadata",
  {
    tmdbId: text("tmdb_id").notNull(),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    runtimeMinutes: integer("runtime_minutes"),
    posterUrl: text("poster_url"),
    backdropUrl: text("backdrop_url"),
    clearLogoUrl: text("clear_logo_url"),
    thumbUrl: text("thumb_url"),
    overview: text("overview"),
    originalLanguage: text("original_language"),
    genres: text("genres", { mode: "json" }).$type<string[] | null>(),
    features: text("features", { mode: "json" }).$type<CanonicalFeatures | null>(),
    lastRefreshedAt: integer("last_refreshed_at").notNull(),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tmdbId, table.mediaType] }),
    index("canonical_metadata_last_refreshed_idx").on(table.lastRefreshedAt),
    index("canonical_metadata_last_accessed_idx").on(table.lastAccessedAt),
  ],
);

export const insertCanonicalMetadataSchema = createInsertSchema(canonicalMetadata);
export const selectCanonicalMetadataSchema = createSelectSchema(canonicalMetadata);

export const discoverSnapshots = sqliteTable(
  "discover_snapshots",
  {
    feedKind: text("feed_kind", { enum: DISCOVER_FEED_KINDS }).notNull(),
    sort: text("sort", { enum: DISCOVER_SORTS }).notNull(),
    day: integer("day").notNull(),
    items: text("items", { mode: "json" }).$type<MetadataKey[]>().notNull(),
    generatedAt: integer("generated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.feedKind, table.sort, table.day] }),
    index("discover_snapshots_day_idx").on(table.day),
  ],
);

export const insertDiscoverSnapshotSchema = createInsertSchema(discoverSnapshots);
export const selectDiscoverSnapshotSchema = createSelectSchema(discoverSnapshots);

export const recommendationLists = sqliteTable(
  "recommendation_lists",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    listKind: text("list_kind", { enum: RECOMMENDATION_LIST_KINDS }).notNull(),
    items: text("items", { mode: "json" }).$type<RecItem[]>().notNull(),
    profileVersion: integer("profile_version").notNull(),
    generatedAt: integer("generated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.listKind] })],
);

export const insertRecommendationListSchema = createInsertSchema(recommendationLists);
export const selectRecommendationListSchema = createSelectSchema(recommendationLists);

export const userHistoryMirror = sqliteTable("user_history_mirror", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  events: text("events", { mode: "json" }).$type<HistoryEvent[]>().notNull(),
  pluginCursors: text("plugin_cursors", { mode: "json" }).$type<PluginCursors>().notNull(),
  lastSyncedAt: integer("last_synced_at").notNull(),
});

export const insertUserHistoryMirrorSchema = createInsertSchema(userHistoryMirror);
export const selectUserHistoryMirrorSchema = createSelectSchema(userHistoryMirror);

export const userRatingsMirror = sqliteTable("user_ratings_mirror", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  events: text("events", { mode: "json" }).$type<RatingEvent[]>().notNull(),
  pluginCursors: text("plugin_cursors", { mode: "json" }).$type<PluginCursors>().notNull(),
  lastSyncedAt: integer("last_synced_at").notNull(),
});

export const insertUserRatingsMirrorSchema = createInsertSchema(userRatingsMirror);
export const selectUserRatingsMirrorSchema = createSelectSchema(userRatingsMirror);
