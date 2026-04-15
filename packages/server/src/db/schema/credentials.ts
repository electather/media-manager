import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sqliteTable, text as sqliteText, integer } from 'drizzle-orm/sqlite-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

const providerEnum = ['trakt', 'tmdb', 'seerr', 'tvdb'] as const

export const credentialsPg = pgTable('credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider', { enum: providerEnum }).notNull(),
  encryptedData: text('encrypted_data').notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const credentialsSqlite = sqliteTable('credentials', {
  id: sqliteText('id').primaryKey(),
  userId: sqliteText('user_id').notNull(),
  provider: sqliteText('provider', { enum: providerEnum }).notNull(),
  encryptedData: sqliteText('encrypted_data').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const insertCredentialPgSchema = createInsertSchema(credentialsPg)
export const selectCredentialPgSchema = createSelectSchema(credentialsPg)
