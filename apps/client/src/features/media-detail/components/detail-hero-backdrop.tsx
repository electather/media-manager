import { useReducedMotion } from "../hooks/use-reduced-motion";
import { useScrollY } from "../hooks/use-scroll-y";

const PARALLAX_FACTOR = 0.35;
const PARALLAX_MAX_PX = 120;

type Props = {
  /** Wide cinematic crop. Falls back to `posterSrc` when unset. */
  src: string | undefined;
  /**
   * Poster used when no backdrop URL is available — keeps the top of the
   * page visually filled instead of collapsing to flat black behind the
   * gradient overlay.
   */
  posterSrc?: string | undefined;
};

/**
 * Cinematic backdrop that bleeds beneath the global TopNav. The image layer
 * extends past the section bounds so an upward parallax never reveals empty
 * space, and a stack of vertical/radial gradients fades the image into the
 * page background by the time the body content starts.
 */
export function DetailHeroBackdrop({ src, posterSrc }: Props) {
  const scrollY = useScrollY();
  const reducedMotion = useReducedMotion();
  const offset = reducedMotion ? 0 : Math.min(PARALLAX_MAX_PX, scrollY * PARALLAX_FACTOR);
  const imageSrc = src ?? posterSrc;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -top-30 bottom-0 -z-10 overflow-hidden"
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          className="absolute -bottom-50 left-0 right-0 top-0 size-full object-cover object-top will-change-transform [transition:transform_60ms_linear]"
          style={{ transform: `translate3d(0, ${-offset}px, 0) scale(1.08)` }}
        />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_30%_10%,transparent_0%,oklch(0_0_0/0.45)_70%),linear-gradient(180deg,oklch(0_0_0/0.20)_0%,oklch(0_0_0/0.40)_40%,var(--background)_78%,var(--background)_100%)]" />
    </div>
  );
}
