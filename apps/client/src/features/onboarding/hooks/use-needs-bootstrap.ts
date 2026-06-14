import { useSuspenseQuery } from "@tanstack/react-query";
import { publicConfigQueryOptions } from "../lib/queries";

/** Reads `needsBootstrap` off the cached public-config query. */
export function useNeedsBootstrap(): boolean {
  const { data } = useSuspenseQuery(publicConfigQueryOptions());
  return data.needsBootstrap;
}
