/**
 * Initial per-section height estimates fed to `VirtualWindowList` so the
 * scroll length stays close-to-correct before `measureElement` corrects
 * the value after the first paint of each section.
 */
export const SECTION_HEIGHT_PX = {
  "tonight-pick": 340,
  "ready-row": 420,
  "mood-mosaic": 560,
  "coming-up": 360,
  awaiting: 480,
  "recently-added": 320,
} as const;

export type WatchlistSectionKind = keyof typeof SECTION_HEIGHT_PX;
