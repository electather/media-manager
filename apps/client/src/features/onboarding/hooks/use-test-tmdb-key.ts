import { useMutation } from "@tanstack/react-query";
import { testTmdbKey } from "../lib/fetchers";

/**
 * Wraps the ephemeral TMDB key probe. The caller owns the result lifetime —
 * call `.reset()` whenever the candidate key value changes so the green/red
 * badge reflects the key currently in the input, not a previously tested one.
 */
export function useTestTmdbKey() {
  return useMutation({ mutationFn: testTmdbKey });
}
