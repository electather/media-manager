/**
 * Cinematic full-bleed backdrop. Pinned to the modal's scroll container so it
 * sits behind every section while the body content scrolls over it. The
 * top-down gradient keeps a hint of the upper hero plate visible while
 * darkening enough that overlaid copy (clear logo, meta line, action row)
 * stays legible over bright cinematography. Mirrors the prototype's
 * `.modal-hero-bg::after` stack but tuned a few stops darker so the page
 * works under high-key artwork too.
 */
export function ModalBackdrop({ src }: { src: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <img src={src} alt="" className="size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, oklch(0 0 0 / 0.60) 0%, oklch(0 0 0 / 0.65) 30%, oklch(0 0 0 / 0.78) 55%, oklch(0 0 0 / 0.90) 80%, oklch(0 0 0 / 0.95) 100%)",
        }}
      />
    </div>
  );
}
