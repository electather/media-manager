import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Wraps the visual frame (image + overlays) inside the card. The `dark`
 * class scopes shadcn tokens to the dark variant for chips that sit on
 * dimmed artwork.
 */
export const MediaCardFrame = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MediaCardFrame({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="media-card-frame"
        className={cn("relative dark", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
