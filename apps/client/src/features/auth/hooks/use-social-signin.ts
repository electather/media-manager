import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/shared/lib/auth";

export type SocialProvider = "apple" | "google";

interface SocialSignInOptions {
  /** URL to redirect to after a successful OAuth round-trip. */
  callbackURL: string | undefined;
  /** URL for IdP error redirect; caller reads provider-appended `?error=` param since mutation state is lost on return. */
  errorCallbackURL: string | undefined;
}

export function useSocialSignIn({ callbackURL, errorCallbackURL }: SocialSignInOptions) {
  return useMutation({
    mutationFn: async (provider: SocialProvider) => {
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: callbackURL ?? "/",
        errorCallbackURL,
      });
      if (error) throw new Error(error.message ?? "Sign-in failed.");
    },
  });
}
