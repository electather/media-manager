import { NotFound } from "@/shared/components/not-found";
import { NotificationToasterHost } from "@/features/notifications";
import { publicConfigQueryOptions } from "@/features/onboarding";
import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, redirect } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";

export interface RouterContext {
  queryClient: QueryClient;
  session: Awaited<ReturnType<typeof authClient.getSession>>["data"];
}

function RootComponent() {
  return (
    <>
      <NotificationToasterHost />
      <Outlet />
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context: { queryClient }, location }) => {
    // Public config drives the fresh-install funnel. If the backend is
    // unreachable we fail open (cfg = null) so every route — including
    // /auth/login — still renders, matching the resilience of the /auth and
    // /_authenticated guards rather than blanking the whole app on an outage.
    const cfg = await queryClient.ensureQueryData(publicConfigQueryOptions()).catch(() => null);
    // A fresh install with zero users funnels every route to the public bootstrap page.
    if (cfg?.needsBootstrap && location.pathname !== "/bootstrap") {
      throw redirect({ to: "/bootstrap" });
    }
  },
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
});
