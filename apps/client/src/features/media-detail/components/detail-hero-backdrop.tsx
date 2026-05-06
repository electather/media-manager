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
 * Cinematic backdrop pinned to the top of the viewport. The whole plate
 * fades out via `scroll-driven-backdrop-fade` (see globals.css) as the user
 * scrolls past the hero — no hard edge against the page background. A
 * top-down dim and a low-left radial pool keep overlaid hero copy legible.
 */
export function DetailHeroBackdrop({ src, posterSrc }: Props) {
  const imageSrc = src ?? posterSrc;
  return (
    <div
      aria-hidden="true"
      className="scroll-driven-backdrop-fade pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {imageSrc ? (
        <img src={imageSrc} alt="" className="size-full object-cover object-top" />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, oklch(0 0 0 / 0.2) 0%, oklch(0 0 0 / 0.45) 70%, oklch(0 0 0 / 0.65) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 25% 85%, oklch(0 0 0 / 0.7) 0%, oklch(0 0 0 / 0.4) 45%, transparent 80%)",
        }}
      />
    </div>
  );
}
