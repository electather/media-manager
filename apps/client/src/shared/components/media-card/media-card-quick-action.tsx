import { type MouseEvent, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

type Props = {
  /** Icon node — caller wires the toggle visuals (Plus / Check / etc). */
  children: ReactNode;
  /** Accessible label; toggle implementations should reflect the current state. */
  "aria-label": string;
  /** Reflects pressed/active state for aria. */
  pressed?: boolean;
  onPress?: () => void;
  className?: string;
};

/**
 * Hover-revealed round button anchored to the bottom-end of the card frame.
 * Presentational only — the parent decides what icon to render and what
 * happens on press. Stops propagation so the underlying card link does not
 * fire on click.
 */
export function MediaCardQuickAction({
  children,
  pressed,
  onPress,
  className,
  "aria-label": ariaLabel,
}: Props) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onPress?.();
  }
  return (
    <Button
      type="button"
      data-slot="media-card-quick-action"
      data-pressed={pressed ? "" : undefined}
      variant="outline"
      size="icon-sm"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={cn(
        "absolute rounded-full inset-e-2 bottom-2 z-30 inline-flex text-foreground opacity-0 backdrop-blur-md transition-all duration-200 hover:bg-background/90 group-focus-within:opacity-100 group-hover:opacity-100",
        className,
      )}
    >
      {children}
    </Button>
  );
}
