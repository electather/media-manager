import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { peekSchema } from "@/lib/home-display";
import { MediaDetailModal } from "@/components/home/media-detail-modal";

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
  return (
    <>
      <Outlet />
      <MediaDetailModal />
    </>
  );
}
