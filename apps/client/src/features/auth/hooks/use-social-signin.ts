import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/shared/lib/auth";

export type SocialProvider = "apple" | "google";

interface SocialSignInOptions {
  /** URL to redirect to after a successful OAuth round-trip. */
  callbackURL: string | undefined;
  /**
   * URL to redirect to when the provider returns an error after the redirect
   * round-trip. The caller should read the provider-appended `?error=` search
   * param and surface it to the user, because the in-component mutation state
   * is gone by the time the browser returns from the IdP.
   */
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
