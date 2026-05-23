import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Compact horizontal compound for listing a media item as one row:
 * thumbnail on the start side, title + meta on the inline-end.
 *
 * Mirrors the slot conventions of `MediaCard` (`data-slot`, `cn` merging,
 * forwardRef + intrinsic attrs spread) so consumers can compose freely.
 * Used by the watchlist mood cluster secondaries today; opt-in primitive
 * for any other "thumb + label" affordance.
 */
export const MediaRowRoot = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function MediaRowRoot({ className, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="media-row"
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg p-1 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      />
    );
  },
);
