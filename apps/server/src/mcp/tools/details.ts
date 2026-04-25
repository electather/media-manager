import { z } from "zod";
import type { MediaService } from "../../media/service";

const inputSchema = z.object({
  id: z.string().describe('Media ID in "movie:550" or "tv:1396" format'),
});

export function detailsTool(mediaService: MediaService) {
  return {
    name: "ent_details" as const,
    description:
      "Get full details for a specific movie or TV show including cast, ratings, watch progress, and availability.",
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      const details = await mediaService.getDetails(input.id);
      if (!details) return { error: "Not found" };
      return { details };
    },
  };
}
