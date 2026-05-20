import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/shared/lib/auth";

export type SocialProvider = "apple" | "google";

export function useSocialSignIn() {
  return useMutation({
    mutationFn: (provider: SocialProvider) =>
      authClient.signIn.social({ provider, callbackURL: "/dashboard" }),
  });
}
