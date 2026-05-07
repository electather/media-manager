import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface RowChevronProps {
  direction: "prev" | "next";
  ariaLabel: string;
  onClick: () => void;
}

export function RowChevron({ direction, ariaLabel, onClick }: RowChevronProps) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        direction === "prev" ? "row-prev inset-s-2" : "row-next inset-e-2",
        "absolute top-1/2 z-20 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/85 text-foreground backdrop-blur-md transition-opacity duration-150 hover:bg-card",
        "[@media(hover:hover)]:inline-flex",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
