import { cn } from "@/shared/lib/utils";

type Props = {
  /** Image URL — preferred when present. */
  src?: string;
  /** Fallback wordmark used when no image URL is available. */
  text?: string;
  alt?: string;
  size?: "sm" | "md" | "lg";
};

const TEXT_SIZES = {
  sm: "text-xs sm:text-sm",
  md: "text-sm sm:text-base",
  lg: "text-2xl sm:text-4xl",
};

const IMAGE_SIZES = {
  sm: "max-h-6 sm:max-h-8",
  md: "max-h-8 sm:max-h-10",
  lg: "max-h-14 sm:max-h-20",
};

/**
 * Wordmark logo overlaid on top of card art for 16/9 thumbnails. Mirrors the
 * prototype's clear-logo treatment so the card reads as a film/show plate.
 * Renders the canonical clear-logo image when available; falls back to a
 * monospace wordmark when the artwork capability has not yet resolved a
 * logo URL.
 */
export function CardClearLogo({ src, text, alt, size = "md" }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        className={cn(
          "pointer-events-none absolute inset-x-3 bottom-3 z-[2] w-auto max-w-[60%] object-contain object-left drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
          IMAGE_SIZES[size],
        )}
      />
    );
  }
  if (!text) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 bottom-3 z-[2] font-mono font-bold tracking-[0.18em] text-foreground drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
        TEXT_SIZES[size],
      )}
    >
      {text}
    </div>
  );
}
