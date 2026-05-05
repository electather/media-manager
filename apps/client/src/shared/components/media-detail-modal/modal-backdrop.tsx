/**
 * Backdrop hero image with two scrims: a vertical fade into the card so the
 * sheet body reads cleanly, and a lateral card-tinted gradient that lifts the
 * title over bright cinematography.
 */
export function ModalBackdrop({ src }: { src: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 sm:h-96"
    >
      <img src={src} alt="" className="size-full object-cover opacity-85" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/35 to-card" />
      <div className="absolute inset-0 bg-gradient-to-r from-card/55 via-transparent to-card/35" />
    </div>
  );
}
