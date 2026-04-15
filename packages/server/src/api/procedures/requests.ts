import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const createRequestSchema = z.object({
  id: z.string(),
  seasons: z.string().optional(),
})

export const requestsApp = new Hono()
  .get('/', async (c) => {
    // TODO: inject MediaService and call mediaService.getRequests().
    return c.json({ items: [] })
  })
  .post('/', zValidator('json', createRequestSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.requestDownload(c.req.valid('json')).
    return c.json({ success: false, message: 'Not implemented' })
  })
