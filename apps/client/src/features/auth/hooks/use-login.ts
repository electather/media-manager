import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";

interface LoginInput {
  email: string;
  password: string;
  rememberMe: boolean;
}

export function useLogin(redirectTo: string | undefined) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ email, password, rememberMe }: LoginInput) => {
      const { error } = await authClient.signIn.email({ email, password, rememberMe });
      if (error) throw new Error(error.message ?? "Login failed.");
    },
    onSuccess: () => {
      void navigate({ to: redirectTo ?? "/" });
    },
  });
}
