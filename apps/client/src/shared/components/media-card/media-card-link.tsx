import { type MouseEvent } from "react";
import { cn } from "@/shared/lib/utils";

type Props = {
  "aria-label": string;
  onPress?: () => void;
  className?: string;
};

/**
 * Transparent absolute-positioned click target laid over the entire card.
 * Lets adjacent overlays (quick action, badges) sit above it without nesting
 * interactive controls inside the root link.
 */
export function MediaCardLink({ "aria-label": ariaLabel, onPress, className }: Props) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onPress?.();
  }
  return (
    <button
      type="button"
      data-slot="media-card-link"
      onClick={onPress ? handleClick : undefined}
      aria-label={ariaLabel}
      className={cn(
        "absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}
