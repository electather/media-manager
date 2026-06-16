import { useMutation } from "@tanstack/react-query";
import type { DeleteAccountBody } from "@nama/shared/users";
import { deleteAccount } from "../fetchers";

/**
 * Mutation hook for permanently deleting the current user's account.
 * The raw `deleteAccount` fetcher is kept internal to `shared/`; this hook is
 * the only export intended for consumer pages.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: (body: DeleteAccountBody) => deleteAccount(body),
  });
}
