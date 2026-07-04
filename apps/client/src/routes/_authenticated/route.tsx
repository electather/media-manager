import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { NotificationToasterHost } from "@/features/notifications";
import { authClient } from "@/shared/lib/auth";
import { peekSchema } from "@/lib/home-display";

export const Route = createFileRoute("/_authenticated")({
  validateSearch: peekSchema,
  // Session + onboarding funnel with loop-break exemptions; CRAP is
  // coverage-estimated in CI and the branches are covered by route-guards.test.ts.
  // fallow-ignore-next-line complexity
  beforeLoad: async ({ location }) => {
    try {
      const { data: session } = await authClient.getSession();
      if (!session) {
        throw redirect({
          to: "/auth/login",
          search: { redirect: location.href },
        });
      }
      // An authenticated user who has not finished onboarding is funneled to the wizard,
      // except on the wizard route itself so it can render.
      if (session.user.hasOnboarded === false && location.pathname !== "/setup") {
        throw redirect({ to: "/setup" });
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
  return (
    <>
      <NotificationToasterHost />
      <Outlet />
    </>
  );
}
