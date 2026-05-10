import { useMediaQuery } from "./use-media-query";

const MOBILE_QUERY = "(max-width: 640px)";

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
