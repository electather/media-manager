import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { useEffect } from "react";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { usePeek } from "../lib/use-peek";
import { useMediaDetail } from "../data";
import { MediaDetailModalContent } from "./media-detail-modal-content";
import { ModalSkeleton } from "./modal-skeleton";
import { TrailerOverlay } from "./trailer-overlay";

// Mounted at the `_authenticated` route layout. Reads `?peek=<kind>:<id>`
// search param via usePeek and renders desktop Dialog or mobile Drawer.
export function MediaDetailModal() {
  const { peekId, closePeek } = usePeek();
  const { item, isHydrating } = useMediaDetail(peekId);
  const open = !!peekId;
  const isMobile = useIsMobile();

  // Cold-URL peek for an id the server cannot resolve: detail RPC settled with
  // null + collection still empty → close so we do not strand the user on a
  // perpetual skeleton.
  useEffect(() => {
    if (peekId && !isHydrating && !item) closePeek();
  }, [peekId, isHydrating, item, closePeek]);

  if (isMobile) {
    return (
      <>
        <DrawerPrimitive.Root open={open} onOpenChange={(next) => !next && closePeek()}>
          <DrawerPrimitive.Portal>
            <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-background/85 backdrop-blur-sm" />
            <DrawerPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[92vh] flex-col rounded-t-2xl bg-background outline-none">
              <div className="mx-auto mt-3 h-1.5 w-24 shrink-0 rounded-full bg-border" />
              <DrawerPrimitive.Title className="sr-only">{item?.title ?? ""}</DrawerPrimitive.Title>
              <DrawerPrimitive.Description className="sr-only">
                {item?.overview ?? ""}
              </DrawerPrimitive.Description>
              <div className="relative flex-1 overflow-hidden">
                {item ? (
                  <MediaDetailModalContent
                    item={item}
                    isHydrating={isHydrating}
                    closePeek={closePeek}
                  />
                ) : (
                  <ModalSkeleton />
                )}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
        <TrailerOverlay />
      </>
    );
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && closePeek()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-background/40 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup
            className="fixed inset-0 z-50 mx-auto flex w-full max-w-[1100px] flex-col overflow-hidden bg-background ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 sm:top-[12vh] sm:bottom-0 sm:rounded-t-2xl"
            aria-label={item?.title ?? "Detail"}
          >
            <DialogPrimitive.Title className="sr-only">{item?.title ?? ""}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {item?.overview ?? ""}
            </DialogPrimitive.Description>
            <div className="relative flex-1 overflow-hidden">
              {item ? (
                <MediaDetailModalContent
                  item={item}
                  isHydrating={isHydrating}
                  closePeek={closePeek}
                />
              ) : (
                <ModalSkeleton />
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <TrailerOverlay />
    </>
  );
}
