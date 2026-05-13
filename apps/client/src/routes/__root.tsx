import { NotFound } from "@/shared/components/not-found";
import { NotificationToasterHost } from "@/features/notifications";
import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

export interface RouterContext {
  queryClient: QueryClient;
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
