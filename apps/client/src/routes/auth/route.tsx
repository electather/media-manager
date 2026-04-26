import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { AuthLayout } from "@/components/app-shell/auth-layout";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    try {
      const { data: session } = await authClient.getSession();
      if (session) {
        throw redirect({ to: "/" });
      }
    } catch (err) {
      // Re-throw TanStack Router redirects; swallow network/parse errors so
      // the auth pages still render when the backend is unavailable.
      if (isRedirect(err)) throw err;
    }
  },
  component: AuthLayout,
});
