import fallback01 from "./poster-fallback-01.svg";
import fallback02 from "./poster-fallback-02.svg";
import fallback03 from "./poster-fallback-03.svg";
import fallback04 from "./poster-fallback-04.svg";
import fallback05 from "./poster-fallback-05.svg";
import fallback06 from "./poster-fallback-06.svg";
import fallback07 from "./poster-fallback-07.svg";
import fallback08 from "./poster-fallback-08.svg";
import fallback09 from "./poster-fallback-09.svg";
import fallback10 from "./poster-fallback-10.svg";

/**
 * Bundled generic branded fallback poster art. These are abstract brand-tinted
 * gradients (no real titles, no TMDB imagery) used to fill the decorative
 * auth-page grid when live posters are unavailable, fewer than the full card
 * count, or fail to load individually. They are cycled across slots.
 */
export const FALLBACK_POSTERS: readonly string[] = [
  fallback01,
  fallback02,
  fallback03,
  fallback04,
  fallback05,
  fallback06,
  fallback07,
  fallback08,
  fallback09,
  fallback10,
];

/** Returns a deterministic fallback poster for a given grid slot index. */
export function fallbackPosterFor(index: number): string {
  return FALLBACK_POSTERS[index % FALLBACK_POSTERS.length] as string;
}
