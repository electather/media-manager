import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

export const MediaRowBody = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function MediaRowBody({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-slot="media-row-body"
        className={cn("flex min-w-0 flex-1 flex-col", className)}
        {...props}
      />
    );
  },
);
