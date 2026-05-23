import { useAllItems } from "./use-all-items";

/** Reader for the "Coming up" strip (bucket=upcoming). */
export function useComingUp() {
  return useAllItems({ bucket: "upcoming" });
}
