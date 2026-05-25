import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

export const MediaRowTitle = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function MediaRowTitle({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="media-row-title"
        className={cn("line-clamp-1 text-sm font-medium text-foreground", className)}
        {...props}
      />
    );
  },
);

export const MediaRowMeta = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function MediaRowMeta({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="media-row-meta"
        className={cn(
          "mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
