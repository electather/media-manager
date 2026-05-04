import { MOCK_FEED } from "../lib/mock-data";
import type { HomeFeedData } from "../lib/types";

export function useHomeFeed(): HomeFeedData {
  return MOCK_FEED;
}
