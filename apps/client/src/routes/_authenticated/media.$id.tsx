import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MediaDetailBody, PEEK_ID_REGEX } from "@/features/home";

const paramsSchema = z.object({ id: z.string().regex(PEEK_ID_REGEX) });

export const Route = createFileRoute("/_authenticated/media/$id")({
  parseParams: (raw) => paramsSchema.parse(raw),
  component: MediaDetailPage,
});

function MediaDetailPage() {
  const { id } = Route.useParams();
  return <MediaDetailBody id={id} inModal={false} />;
}
