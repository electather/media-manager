import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authenticated")({
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

/** App shell with sidebar navigation used by all authenticated routes. */
function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
