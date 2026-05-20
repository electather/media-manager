import { PosterGridBackground } from "./poster-grid-background";
import styles from "./auth-overlays.module.css";

export function AuthOverlays() {
  return (
    <>
      <PosterGridBackground />
      <div className={styles.veil} />
      <div className={styles.vignette} />
      <div className={styles.noise} />
    </>
  );
}
