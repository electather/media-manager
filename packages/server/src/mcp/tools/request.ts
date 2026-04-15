import { z } from 'zod'
import type { MediaService } from '../../media/service'

const inputSchema = z.object({
  id: z.string().describe('Media ID in "movie:550" or "tv:1396" format'),
  seasons: z
    .string()
    .optional()
    .describe('Specific seasons to request for TV shows, e.g. "1,2,3" or "all"'),
})

export function requestTool(mediaService: MediaService) {
  return {
    name: 'ent_request' as const,
    description:
      'Request a movie or TV show for download. Submits the request to the configured download manager.',
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      const result = await mediaService.requestDownload(input.id, input.seasons)
      return result
    },
  }
}
