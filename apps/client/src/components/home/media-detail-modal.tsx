import { useRouter, useSearch } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaDetailBody } from "./media-detail-body";

export function MediaDetailModal() {
  const router = useRouter();
  const search = useSearch({ strict: false }) as { peek?: string };
  const peek = search.peek;

  function close() {
    // Default replace: true rewrites the "peek open" history entry instead of
    // pushing a new one, so a single browser-back dismisses the modal.
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...(prev as Record<string, unknown>), peek: undefined }),
    });
  }

  return (
    <Dialog open={!!peek} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto sm:rounded-lg max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:max-h-none max-sm:rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Media detail</DialogTitle>
        </DialogHeader>
        {peek ? <MediaDetailBody id={peek} inModal /> : null}
      </DialogContent>
    </Dialog>
  );
}
