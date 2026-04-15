import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { drizzle as drizzleSqlite } from 'drizzle-orm/libsql'
import postgres from 'postgres'
import { createClient } from '@libsql/client'
import { env } from '../env'
import * as schema from './schema/index'

type DrizzlePostgresDb = ReturnType<typeof drizzlePostgres>
type DrizzleSqliteDb = ReturnType<typeof drizzleSqlite>
export type Db = DrizzlePostgresDb | DrizzleSqliteDb

let instance: Db | undefined

/** Returns a singleton Drizzle instance based on DB_PROVIDER. */
export function getDb(): Db {
  if (instance) return instance

  if (env.DB_PROVIDER === 'postgres') {
    const client = postgres(env.DATABASE_URL!)
    instance = drizzlePostgres(client, { schema })
  } else {
    const client = createClient({ url: env.SQLITE_PATH ?? './data/ent-mcp.db' })
    instance = drizzleSqlite(client, { schema })
  }

  return instance
}
