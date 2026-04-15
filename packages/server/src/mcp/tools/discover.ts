import { z } from 'zod'
import type { MediaService } from '../../media/service'

const inputSchema = z.object({
  query: z.string().optional().describe('Free-text search query'),
  mediaType: z.enum(['movie', 'tv']).optional().describe('Filter by media type'),
  genres: z.array(z.string()).optional().describe('Filter by genre names'),
  yearMin: z.number().int().optional().describe('Minimum release year'),
  yearMax: z.number().int().optional().describe('Maximum release year'),
  ratingMin: z.number().optional().describe('Minimum average rating (0-10)'),
  limit: z.number().int().min(1).max(50).default(10).describe('Number of results'),
})

export function discoverTool(mediaService: MediaService) {
  return {
    name: 'ent_discover' as const,
    description:
      'Discover movies and TV shows. Searches by query or browses with filters. Returns ranked results personalized to the user.',
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      if (input.query) {
        const results = await mediaService.search(input.query, input.mediaType, input.limit)
        return { results }
      }
      const results = await mediaService.discover({
        genres: input.genres,
        yearMin: input.yearMin,
        yearMax: input.yearMax,
        ratingMin: input.ratingMin,
        limit: input.limit,
      })
      return { results }
    },
  }
}
