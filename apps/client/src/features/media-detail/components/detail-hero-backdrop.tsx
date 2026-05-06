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
 * Cinematic backdrop that fills the hero section and bleeds beneath the
 * global TopNav. Mirrors the modal's `ModalBackdrop` pattern: a static
 * `object-cover` image plus a top-down dark gradient that keeps overlaid
 * copy (clear logo, meta line, action row) legible. No parallax — content
 * scrolls cleanly over the fixed plate.
 */
export function DetailHeroBackdrop({ src, posterSrc }: Props) {
  const imageSrc = src ?? posterSrc;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {imageSrc ? (
        <img src={imageSrc} alt="" className="size-full object-cover object-top" />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, oklch(0 0 0 / 0.45) 0%, oklch(0 0 0 / 0.55) 35%, oklch(0 0 0 / 0.78) 65%, var(--background) 95%, var(--background) 100%)",
        }}
      />
    </div>
  );
}
