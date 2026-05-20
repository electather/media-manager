import { type MouseEvent } from "react";
import { cn } from "@/shared/lib/utils";

type Props = {
  /** Canonical detail-page URL; powers new-tab / cmd-click / right-click. */
  href: string;
  /**
   * Plain left-click override (e.g. open the peek modal in place). Modified
   * clicks (cmd/ctrl/shift/alt/middle button) skip the override so the
   * browser's native open-in-new-tab still works.
   */
  onPress?: () => void;
  "aria-label": string;
  className?: string;
};

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/**
 * Transparent absolute-positioned anchor laid over the entire card. Anchor
 * keeps native open-in-new-tab semantics; `onPress` intercepts plain
 * left-clicks for SPA navigation / peek modals while modifier-clicks fall
 * through to the browser default.
 */
export function MediaCardLink({ href, onPress, "aria-label": ariaLabel, className }: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onPress) return;
    if (isModifiedClick(event)) return;
    event.preventDefault();
    onPress();
  }
  return (
    <a
      data-slot="media-card-link"
      href={href}
      onClick={handleClick}
      aria-label={ariaLabel}
      className={cn(
        "absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}
