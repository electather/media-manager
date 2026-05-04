export function ModalBackdrop({ src }: { src: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 sm:h-96"
    >
      <img src={src} alt="" className="size-full object-cover opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/40 to-card" />
    </div>
  );
}
