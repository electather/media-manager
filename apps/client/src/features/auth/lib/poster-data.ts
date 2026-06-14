// Pure layout constants for the decorative auth-page poster grid. The poster
// imagery itself now comes from live trending data (with bundled fallback art),
// so only the row geometry and scroll tuning live here.

// Row config: 6 rows alternate direction, vary speed and scale for depth.
export const ROW_CONFIG = [
  { baseSpeed: 120, direction: 1, scale: 0.85 },
  { baseSpeed: 90, direction: -1, scale: 1.0 },
  { baseSpeed: 140, direction: 1, scale: 0.95 },
  { baseSpeed: 100, direction: -1, scale: 1.05 },
  { baseSpeed: 130, direction: 1, scale: 0.95 },
  { baseSpeed: 110, direction: -1, scale: 1.0 },
] as const;

export const ROW_POSTER_COUNT = 14;
// Multiplier on `baseSpeed` to land on a slow drift (e.g. baseSpeed 120 × 5
// = 600 s per cycle). Tuned against the original mock; bigger = slower.
export const ROW_SPEED_SCALE = 5;
