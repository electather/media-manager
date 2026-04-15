import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import { migrate as migrateSqlite } from 'drizzle-orm/libsql/migrator'
import { consola } from 'consola'
import { getDb } from './client'
import { env } from '../env'

/** Runs Drizzle migrations against the configured database. */
export async function runMigrations(): Promise<void> {
  const db = getDb()

  consola.info('Running database migrations...')

  if (env.DB_PROVIDER === 'postgres') {
    await migratePostgres(db as Parameters<typeof migratePostgres>[0], {
      migrationsFolder: './drizzle',
    })
  } else {
    await migrateSqlite(db as Parameters<typeof migrateSqlite>[0], {
      migrationsFolder: './drizzle',
    })
  }

  consola.success('Database migrations complete.')
}
