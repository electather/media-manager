import { PosterGridBackground } from "./poster-grid-background";
import styles from "./auth-overlays.module.css";

export function AuthOverlays() {
  return (
    <>
      <PosterGridBackground />
      <div className={`pointer-events-none fixed inset-0 z-5 ${styles.veil}`} />
      <div className={`pointer-events-none fixed inset-0 z-5 ${styles.vignette}`} />
      <div
        className={`pointer-events-none fixed inset-0 z-6 opacity-[0.04] mix-blend-overlay ${styles.noise}`}
      />
    </>
  );
}
