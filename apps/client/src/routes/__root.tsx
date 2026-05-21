import { NotFound } from "@/shared/components/not-found";
import { NotificationToasterHost } from "@/features/notifications";
import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
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
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
});
