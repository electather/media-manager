import { PlayIcon, XIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { LoadingImage } from "@/shared/components/loading-image";
import { useDetailStore } from "../lib/use-detail-store";
import { useMediaRow } from "../data";

export function TrailerOverlay() {
  const { trailerId, closeTrailer } = useDetailStore();
  const item = useMediaRow(trailerId);
  const open = !!trailerId;

  if (!open) return null;

  const heroImage = item?.backdrop ?? item?.poster ?? "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-sm"
      onClick={closeTrailer}
    >
      {item && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative aspect-video w-[min(1100px,calc(100vw-48px))] overflow-hidden rounded-xl bg-black shadow-2xl"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={closeTrailer}
            aria-label={m.media_details_close_trailer()}
            className="absolute top-3 right-3 z-10 bg-foreground/10 text-foreground hover:bg-foreground/20"
          >
            <XIcon className="size-4" />
          </Button>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground/80">
            <div className="absolute inset-0 opacity-35">
              <LoadingImage src={heroImage} alt="" className="size-full object-cover" />
            </div>
            <div className="relative flex size-20 items-center justify-center rounded-full border border-foreground/20 bg-foreground/10 text-foreground">
              <PlayIcon className="size-7" />
            </div>
            <div className="relative font-mono text-[13px] text-muted-foreground">
              {m.media_details_trailer_caption({ title: item.title })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
