import { cn } from "@/shared/lib/utils";

type Props = {
  text: string;
  size?: "sm" | "md" | "lg";
};

const SIZES = {
  sm: "text-[11px] sm:text-sm",
  md: "text-sm sm:text-base",
  lg: "text-2xl sm:text-4xl",
};

/**
 * Wordmark logo overlaid on top of card art for 16/9 thumbnails. Mirrors the
 * prototype's clear-logo treatment so the card reads as a film/show plate.
 */
export function CardClearLogo({ text, size = "md" }: Props) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 bottom-3 z-[2] font-mono font-bold tracking-[0.18em] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
        SIZES[size],
      )}
    >
      {text}
    </div>
  );
}
