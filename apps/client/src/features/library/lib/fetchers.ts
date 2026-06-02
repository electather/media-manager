import { SAMPLE_LIBRARY } from "../__fixtures__/library-items.fixture";
import type { LibraryData } from "./types";

/**
 * Library data source. The unified media API (epic #491) does not yet expose a
 * catalog endpoint, so this resolves the mock fixture; the React Query wiring,
 * grouping, and filtering are all real and will keep working unchanged once
 * this swaps to an `api.*` call. Async to model the eventual network fetch.
 */
export async function fetchLibrary(): Promise<LibraryData> {
  return Promise.resolve(SAMPLE_LIBRARY);
}
