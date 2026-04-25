import { z } from "zod";
import type { MediaService } from "../../media/service";

const inputSchema = z.object({
  id: z.string().describe('Media ID in "movie:550" or "tv:1396" format'),
  action: z.enum(["like", "dislike", "rate", "note"]).describe("Type of feedback"),
  rating: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Rating 1-10, required when action=rate"),
  note: z.string().optional().describe("Free-text note, required when action=note"),
});

export function feedbackTool(mediaService: MediaService) {
  return {
    name: "ent_feedback" as const,
    description:
      "Record feedback for a movie or TV show. Updates preference signals and syncs ratings to connected services.",
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      await mediaService.recordFeedback(input.id, input.action, input.rating, input.note);
      return { success: true };
    },
  };
}
