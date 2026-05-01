import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMediaDetail } from "@/features/media";
import { MediaDetailModalContent } from "@/features/media/components/media-detail-modal-content";
import { ModalSkeleton } from "@/features/media/components/modal-skeleton";

export const Route = createFileRoute("/_authenticated/_app/media/$id")({
  component: MediaDetailFullPage,
});

function MediaDetailFullPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { item, isHydrating } = useMediaDetail(id);

  const back = () => router.history.back();

  if (!item && isHydrating) return <ModalSkeleton />;
  if (!item)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-10">
        <h1 className="text-2xl font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">No media for {id}.</p>
      </div>
    );

  return <MediaDetailModalContent item={item} isHydrating={isHydrating} closePeek={back} />;
}
