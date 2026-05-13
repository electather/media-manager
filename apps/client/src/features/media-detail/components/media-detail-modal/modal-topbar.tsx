import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { ExternalLink, Film, Tv, X } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  /** Optional callback to escalate the modal peek into the full detail page. */
  onViewFullPage?: () => void;
};

/**
 * Sticky top bar inside the modal scroll container. The frosted background
 * fades in via a scroll-timeline keyframe (see `scroll-driven-topbar-bg` in
 * globals.css), so once the user scrolls past the hero plate the close
 * button still has contrast against the body surface.
 *
 * The close button delegates to base-ui's `Dialog.Close` primitive — which
 * both `Dialog` and `Sheet` are built on — so the surrounding popup runs
 * its proper close animation and restores focus to the trigger element.
 *
 * Note: the prototype collapses the kind badge label and docks the clear
 * logo into this bar on scroll. We keep both static here — the body title
 * shrink (`scroll-driven-title`) carries enough of the "compacts on scroll"
 * affordance without the imperative measure-and-position rig the prototype
 * uses.
 */
export function ModalTopbar({ item, onViewFullPage }: Props) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
      <div
        aria-hidden="true"
        className="scroll-driven-topbar-bg pointer-events-none absolute inset-0 border-b border-border bg-card/85 opacity-0 supports-backdrop-filter:bg-card/65 supports-backdrop-filter:backdrop-blur-md"
      />
      <KindBadge kind={item.mediaType} />
      <div className="flex-1" />
      {onViewFullPage ? <ViewFullPageButton onClick={onViewFullPage} /> : null}
      <BaseDialog.Close
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={m.home_detail_close()}
            className="relative bg-card/60 supports-backdrop-filter:bg-background/40 supports-backdrop-filter:backdrop-blur"
          />
        }
      >
        <X aria-hidden="true" />
      </BaseDialog.Close>
    </div>
  );
}

function ViewFullPageButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={m.media_detail_view_full_page()}
      className="relative bg-card/60 supports-backdrop-filter:bg-background/40 supports-backdrop-filter:backdrop-blur"
    >
      <ExternalLink aria-hidden="true" />
      <span className="hidden sm:inline">{m.media_detail_view_full_page()}</span>
    </Button>
  );
}

function KindBadge({ kind }: { kind: MediaDetailItem["mediaType"] }) {
  const Icon = kind === "movie" ? Film : Tv;
  const label = kind === "movie" ? m.home_card_kind_movie() : m.home_card_kind_tv();
  return (
    <Badge
      variant="glass"
      className="relative gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] uppercase"
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
