import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";
import { peekSchema } from "@/lib/home-display";

export const Route = createFileRoute("/_authenticated")({
  validateSearch: peekSchema,
  beforeLoad: async ({ location }) => {
    try {
      const { data: session } = await authClient.getSession();
      if (!session) {
        throw redirect({
          to: "/auth/login",
          search: { redirect: location.href },
        });
      }
      return { session };
    } catch (err) {
      // Re-throw redirects; on any other error (network failure, etc.)
      // also redirect to login so protected pages are never exposed.
      if (isRedirect(err)) throw err;
      throw redirect({ to: "/auth/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
