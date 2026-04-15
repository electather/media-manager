import { consola } from 'consola'

/** Removes expired entries from the active cache provider. */
export async function cacheCleanupJob(): Promise<void> {
  consola.debug('Running cache cleanup job')
  // TODO: implement - for Redis, SCAN and remove expired keys; LRU-cache handles its own TTL.
}
