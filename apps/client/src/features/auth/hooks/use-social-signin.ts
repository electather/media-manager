import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/shared/lib/auth";

export type SocialProvider = "apple" | "google";

export function useSocialSignIn(callbackURL: string | undefined) {
  return useMutation({
    mutationFn: async (provider: SocialProvider) => {
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: callbackURL ?? "/",
      });
      if (error) throw new Error(error.message ?? "Sign-in failed.");
    },
  });
}
