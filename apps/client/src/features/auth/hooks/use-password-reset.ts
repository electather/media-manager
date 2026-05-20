import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";

interface ResetInput {
  email: string;
}

export function usePasswordReset() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ email }: ResetInput) => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/auth/reset-password",
      });
      if (error) throw new Error(error.message ?? "Something went wrong.");
    },
    onSuccess: () => {
      void navigate({ to: "/auth/forgot-password/sent" });
    },
  });
}
