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
    <div
      aria-hidden="true"
      className="scroll-driven-modal-backdrop-fade pointer-events-none absolute inset-x-0 top-0 h-72 -z-10 overflow-hidden sm:h-96 mask-[linear-gradient(to_bottom,black_0%,black_70%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_70%,transparent_100%)]"
    >
      <img src={src} alt="" className="size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in oklch, var(--background) 60%, transparent) 0%, color-mix(in oklch, var(--background) 65%, transparent) 30%, color-mix(in oklch, var(--background) 78%, transparent) 55%, color-mix(in oklch, var(--background) 90%, transparent) 80%, color-mix(in oklch, var(--background) 95%, transparent) 100%)",
        }}
      />
    </div>
  );
}
