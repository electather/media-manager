import { Hono } from 'hono'
import { discoverApp } from './procedures/discover'
import { activityApp } from './procedures/activity'
import { requestsApp } from './procedures/requests'
import { settingsApp } from './procedures/settings'

/** Hono sub-app that handles all /api/* RPC calls. Re-exported type for client. */
export const appRouter = new Hono()
  .route('/discover', discoverApp)
  .route('/activity', activityApp)
  .route('/requests', requestsApp)
  .route('/settings', settingsApp)

export type AppType = typeof appRouter
