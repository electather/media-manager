import { useMutation } from "@tanstack/react-query";
import { testTmdbKey } from "../lib/fetchers";

/**
 * Wraps the ephemeral TMDB key probe. Returns the mutation object; callers
 * own result lifetime and should call `.reset()` when the candidate key value
 * changes.
 */
export function useTestTmdbKey() {
  return useMutation({ mutationFn: testTmdbKey });
}
