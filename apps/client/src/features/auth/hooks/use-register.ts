import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export function useRegister() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ name, email, password }: RegisterInput) => {
      const { error } = await authClient.signUp.email({ name, email, password });
      if (error) throw new Error(error.message ?? "Registration failed.");
    },
    onSuccess: () => {
      void navigate({ to: "/" });
    },
  });
}
