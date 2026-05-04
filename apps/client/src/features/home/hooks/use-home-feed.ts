import { invariant } from "es-toolkit/util";
import { MOCK_FEED } from "../lib/mock-data";
import type { HomeFeedData } from "../lib/types";

export function useHomeFeed(): HomeFeedData {
  invariant(MOCK_FEED.hero !== null, "mock data must supply a hero");
  return MOCK_FEED;
}
