import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { user } from "../auth/auth";

/**
 * Marker rows. Presence means the user has been seeded from the owned
 * collection feed at least once. Eager-seed on first read upserts here so the
 * 6-hourly sync cron can iterate exactly the seeded users.
 */
export const userLibrarySeed = sqliteTable("user_library_seed", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seededAt: integer("seeded_at").notNull(),
});
