import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

import { useClosePeek, usePeekParam } from "../lib/peek";
import { MediaDetailBody } from "./media-detail-body";

export function MediaDetailModal() {
  const peek = usePeekParam();
  const close = useClosePeek();

  return (
    <Dialog open={peek !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[100dvh] w-full max-w-none rounded-none p-0 sm:max-h-[90vh] sm:max-w-3xl sm:rounded-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Media detail</DialogTitle>
        </DialogHeader>
        {peek ? <MediaDetailBody id={peek} inModal /> : null}
      </DialogContent>
    </Dialog>
  );
}
