import { useAllItems } from "./use-all-items";

/** Reader for the "Awaiting" strip (bucket=awaiting). */
export function useAwaiting() {
  return useAllItems({ bucket: "awaiting" });
}
