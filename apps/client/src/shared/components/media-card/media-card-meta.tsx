import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Footer wrapper rendered below the card frame. Hosts title, subtitle, and
 * any feature-specific chips.
 */
export const MediaCardMeta = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MediaCardMeta({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="media-card-meta"
        className={cn("mt-2 flex flex-col px-0.5", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
