import { consola } from 'consola'

/** Refreshes expiring OAuth tokens for all connected integrations. */
export async function tokenRefreshJob(): Promise<void> {
  consola.debug('Running token refresh job')
  // TODO: implement - query credentials table for tokens expiring within the next hour.
}
