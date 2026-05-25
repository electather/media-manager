import { useAllItems } from "./use-all-items";

/**
 * Reader for the curated "Ready to watch" strip: items the user can stream
 * tonight without a request. Thin wrapper over `useAllItems` so the query
 * cache stays unified under the `items` key family.
 */
export function useReadyRow() {
  return useAllItems({ bucket: "ready" });
}
