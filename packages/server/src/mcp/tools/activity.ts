import { z } from 'zod'
import type { MediaService } from '../../media/service'

const inputSchema = z.object({
  type: z
    .enum(['history', 'watchlist', 'progress', 'upcoming', 'requests'])
    .describe('Which activity feed to retrieve'),
  mediaType: z.enum(['movie', 'tv']).optional().describe('Filter by media type'),
  limit: z.number().int().min(1).max(100).default(20).describe('Number of results'),
})

export function activityTool(mediaService: MediaService) {
  return {
    name: 'ent_activity' as const,
    description:
      'Retrieve watch history, watchlist, in-progress shows, upcoming episodes, or download requests.',
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      switch (input.type) {
        case 'history':
          return { items: await mediaService.getHistory(input.limit) }
        case 'watchlist':
          return { items: await mediaService.getWatchlist(input.mediaType) }
        case 'progress':
          return { items: await mediaService.getProgress() }
        case 'upcoming':
          return { items: await mediaService.getUpcoming() }
        case 'requests':
          return { items: await mediaService.getRequests() }
      }
    },
  }
}
