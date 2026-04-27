import { createFileRoute, notFound } from "@tanstack/react-router";
import { PEEK_ID_REGEX } from "@/lib/home-display";
import { MediaDetailBody } from "@/components/home/media-detail-body";

export const Route = createFileRoute("/_authenticated/media/$id")({
  beforeLoad: ({ params }) => {
    if (!PEEK_ID_REGEX.test(params.id)) throw notFound();
  },
  component: MediaDetailPage,
});

function MediaDetailPage() {
  const { id } = Route.useParams();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 lg:px-6">
      <MediaDetailBody id={id} inModal={false} />
    </div>
  );
}
