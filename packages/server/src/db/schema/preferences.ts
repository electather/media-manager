import { pgTable, text, timestamp, json } from 'drizzle-orm/pg-core'
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  blob,
} from 'drizzle-orm/sqlite-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

export const preferencesPg = pgTable('preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique(),
  genreScores: json('genre_scores').notNull().default({}),
  themeScores: json('theme_scores').notNull().default({}),
  keywordScores: json('keyword_scores').notNull().default({}),
  directorScores: json('director_scores').notNull().default({}),
  actorScores: json('actor_scores').notNull().default({}),
  lastComputedAt: timestamp('last_computed_at').notNull().defaultNow(),
})

export const preferencesSqlite = sqliteTable('preferences', {
  id: sqliteText('id').primaryKey(),
  userId: sqliteText('user_id').notNull().unique(),
  genreScores: blob('genre_scores', { mode: 'json' }).notNull(),
  themeScores: blob('theme_scores', { mode: 'json' }).notNull(),
  keywordScores: blob('keyword_scores', { mode: 'json' }).notNull(),
  directorScores: blob('director_scores', { mode: 'json' }).notNull(),
  actorScores: blob('actor_scores', { mode: 'json' }).notNull(),
  lastComputedAt: sqliteInteger('last_computed_at', { mode: 'timestamp' }).notNull(),
})

export const insertPreferencesPgSchema = createInsertSchema(preferencesPg)
export const selectPreferencesPgSchema = createSelectSchema(preferencesPg)
