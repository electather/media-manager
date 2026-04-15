import { Cron } from 'croner'
import { consola } from 'consola'
import { tokenRefreshJob } from './token-refresh'
import { cacheCleanupJob } from './cache-cleanup'

const jobs: Cron[] = []

function registerJob(expression: string, name: string, fn: () => Promise<void>): void {
  const job = new Cron(expression, { name }, () => {
    fn().catch((err: unknown) => consola.error(`Job ${name} failed`, err))
  })
  jobs.push(job)
  consola.debug(`Registered job "${name}" with schedule "${expression}"`)
}

export const scheduler = {
  start(): void {
    registerJob('*/30 * * * *', 'token-refresh', tokenRefreshJob)
    registerJob('0 * * * *', 'cache-cleanup', cacheCleanupJob)
    consola.info(`Scheduler started with ${jobs.length} jobs`)
  },

  stop(): void {
    for (const job of jobs) {
      job.stop()
    }
    consola.info('Scheduler stopped')
  },
}
