import { forwardRef, type HTMLAttributes } from "react";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

type Position = "top-start" | "top-end" | "bottom-start" | "bottom-end";

interface MediaCardBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  position?: Position;
}

const POSITION_CLASS: Record<Position, string> = {
  "top-start": "start-2 top-2",
  "top-end": "end-2 top-2",
  "bottom-start": "start-2 bottom-2",
  "bottom-end": "end-2 bottom-2",
};

/**
 * Absolute-positioned badge slot on top of card art. Wraps the shared `Badge`
 * primitive so callers get consistent token defaults; pass content (icon
 * and/or text) as children.
 */
export const MediaCardBadge = forwardRef<HTMLSpanElement, MediaCardBadgeProps>(
  function MediaCardBadge({ className, position = "top-end", children, ...props }, ref) {
    return (
      <Badge
        ref={ref}
        variant="glass"
        data-slot="media-card-badge"
        data-position={position}
        className={cn(
          "pointer-events-none absolute size-6 rounded-md p-0 [&>svg]:size-3.5!",
          POSITION_CLASS[position],
          className,
        )}
        {...props}
      >
        {children}
      </Badge>
    );
  },
);
