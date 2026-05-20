import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

export const MediaCardTitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function MediaCardTitle({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="media-card-title"
      className={cn("line-clamp-1 text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
});

export const MediaCardSubtitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function MediaCardSubtitle({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="media-card-subtitle"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
});

export const MediaCardCaption = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function MediaCardCaption({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="media-card-caption"
      className={cn("mt-1 line-clamp-1 text-xs text-muted-foreground/85", className)}
      {...props}
    />
  );
});
