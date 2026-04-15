import { pgTable, text, timestamp, integer, json } from 'drizzle-orm/pg-core'
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  blob,
} from 'drizzle-orm/sqlite-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

const mediaTypeEnum = ['movie', 'tv'] as const
const actionEnum = ['like', 'dislike', 'rate', 'note'] as const

export const feedbackPg = pgTable('feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tmdbId: text('tmdb_id').notNull(),
  mediaType: text('media_type', { enum: mediaTypeEnum }).notNull(),
  action: text('action', { enum: actionEnum }).notNull(),
  rating: integer('rating'),
  note: text('note'),
  extractedSignals: json('extracted_signals'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const feedbackSqlite = sqliteTable('feedback', {
  id: sqliteText('id').primaryKey(),
  userId: sqliteText('user_id').notNull(),
  tmdbId: sqliteText('tmdb_id').notNull(),
  mediaType: sqliteText('media_type', { enum: mediaTypeEnum }).notNull(),
  action: sqliteText('action', { enum: actionEnum }).notNull(),
  rating: sqliteInteger('rating'),
  note: sqliteText('note'),
  extractedSignals: blob('extracted_signals', { mode: 'json' }),
  createdAt: sqliteInteger('created_at', { mode: 'timestamp' }).notNull(),
})

export const insertFeedbackPgSchema = createInsertSchema(feedbackPg)
export const selectFeedbackPgSchema = createSelectSchema(feedbackPg)
