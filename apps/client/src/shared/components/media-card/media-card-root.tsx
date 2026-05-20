import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

type Aspect = "16/9" | "2/3";

interface MediaCardRootProps extends HTMLAttributes<HTMLElement> {
  aspect?: Aspect;
}

/**
 * Outer container of the MediaCard compound. Sets `data-aspect` so child
 * slots can style off it. Carries the `group` class so hover/focus states
 * propagate to slotted children (quick action, scrim, etc).
 */
export const MediaCardRoot = forwardRef<HTMLElement, MediaCardRootProps>(function MediaCardRoot(
  { className, aspect, children, ...props },
  ref,
) {
  return (
    <article
      ref={ref}
      data-slot="media-card"
      data-aspect={aspect}
      className={cn("group relative isolate flex w-full flex-col", className)}
      {...props}
    >
      {children}
    </article>
  );
});
