import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import Layout from "@/components/app/layout";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async ({ location }) => {
    try {
      const { data: session } = await authClient.getSession();
      if (!session) {
        throw redirect({
          to: "/auth/login",
          search: { redirect: location.href },
        });
      }
    } catch (err) {
      // Re-throw redirects; on any other error (network failure, etc.)
      // also redirect to login so protected pages are never exposed.
      if (isRedirect(err)) throw err;
      throw redirect({ to: "/auth/login" });
    }
  },
  component: Layout,
});
