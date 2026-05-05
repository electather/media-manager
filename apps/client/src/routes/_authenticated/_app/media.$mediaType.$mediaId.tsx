import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MediaDetailPage } from "@/features/media-detail";
import { buildCompositeId } from "@/shared/lib/media-id";

const paramsSchema = z.object({
  mediaType: z.enum(["movie", "tv"]),
  mediaId: z.string().regex(/^[\w-]+$/),
});

export const Route = createFileRoute("/_authenticated/_app/media/$mediaType/$mediaId")({
  parseParams: (params) => paramsSchema.parse(params),
  component: MediaDetailRoute,
});

function MediaDetailRoute() {
  const { mediaType, mediaId } = Route.useParams();
  return <MediaDetailPage compositeId={buildCompositeId(mediaType, mediaId)} />;
}
