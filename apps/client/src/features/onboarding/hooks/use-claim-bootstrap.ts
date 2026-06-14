import { useMutation } from "@tanstack/react-query";
import { claimBootstrap } from "../lib/fetchers";

/** Creates the first administrator from the one-time setup token. */
export function useClaimBootstrap() {
  return useMutation({ mutationFn: claimBootstrap });
}
