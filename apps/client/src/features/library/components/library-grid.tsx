/**
 * The auto-fill poster grid track shared by the lens grids and their loading
 * skeleton, so both reserve the exact same column track and gaps and the page
 * doesn't reflow when real cards replace the placeholders. The lens bodies now
 * window-virtualize their grids (`LibrarySectionGrid` mirrors these metrics in
 * JS via `VirtualGrid`), so only the skeleton renders this class directly.
 */
export const LIBRARY_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]";
