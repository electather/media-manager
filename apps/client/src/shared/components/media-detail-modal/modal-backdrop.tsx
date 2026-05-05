/**
 * Cinematic full-bleed backdrop. Pinned to the modal's scroll container so it
 * sits behind every section while the body content scrolls over it. The
 * top-down gradient keeps the upper third bright (so the clear logo reads
 * over a hero plate) and fades to the card surface near the body content,
 * mirroring the prototype's modal hero treatment.
 */
export function ModalBackdrop({ src }: { src: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <img src={src} alt="" className="size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, oklch(0 0 0 / 0.30) 0%, oklch(0 0 0 / 0.30) 30%, oklch(0 0 0 / 0.55) 55%, oklch(0 0 0 / 0.78) 80%, oklch(0 0 0 / 0.88) 100%)",
        }}
      />
    </div>
  );
}
