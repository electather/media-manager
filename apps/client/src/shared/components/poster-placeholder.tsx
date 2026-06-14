import { cn } from "@/shared/lib/utils";

/** Base brand hue (indigo) shared by every placeholder tint. */
const BASE_HUE = 265;

/**
 * Spreads the tint across a small range so a grid of placeholders reads as
 * varied art rather than one repeated tile. Deterministic in the seed.
 */
function hueFor(seed: number): number {
  return BASE_HUE + ((Math.abs(seed) % 5) - 2) * 14;
}

export interface PosterPlaceholderProps {
  className?: string;
  /** Varies the gradient tint; pass the grid slot index for variety. */
  seed?: number;
  /** Adds a pulse, for use as a poster loading skeleton. */
  animate?: boolean;
}

/**
 * Decorative 2:3 poster placeholder: a brand-tinted gradient with the logo
 * pressed into the surface as an emboss. The logo is drawn by masking a
 * tone-on-tone fill with `/logo-dark.svg` and lighting it with a highlight on
 * top and a shadow below, so it reads as raised relief rather than a printed
 * mark. Shared so it doubles as the loading skeleton for posters elsewhere
 * (pass `animate`).
 */
export function PosterPlaceholder({
  className,
  seed = 0,
  animate = false,
}: PosterPlaceholderProps) {
  const h = hueFor(seed);
  return (
    <div
      aria-hidden="true"
      data-slot="poster-placeholder"
      className={cn(
        "relative isolate size-full overflow-hidden bg-muted",
        animate && "animate-pulse",
        className,
      )}
      style={{
        background: `radial-gradient(120% 90% at 50% 38%, oklch(0.32 0.09 ${h}) 0%, oklch(0.19 0.06 ${h}) 55%, oklch(0.11 0.035 ${h}) 100%)`,
      }}
    >
      <div
        className="absolute top-1/2 left-1/2 aspect-square w-[46%] -translate-x-1/2 -translate-y-1/2"
        style={{
          backgroundColor: `oklch(0.27 0.07 ${h})`,
          maskImage: "url(/logo-dark.svg)",
          WebkitMaskImage: "url(/logo-dark.svg)",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
          maskSize: "contain",
          WebkitMaskSize: "contain",
          filter:
            "drop-shadow(0 -1px 0.5px oklch(1 0 0 / 0.22)) drop-shadow(0 2px 1.5px oklch(0 0 0 / 0.6))",
        }}
      />
    </div>
  );
}
