import { Link, Outlet } from "@tanstack/react-router";
import { TvIcon, XIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";

const ACCOUNT_NAV = [
  { to: "/settings/profile", label: "Profile" },
  { to: "/settings/security", label: "Security" },
  { to: "/settings/connections", label: "Connections" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/apps", label: "Authorized apps" },
  { to: "/settings/danger", label: "Danger zone" },
] as const;

const ADMIN_NAV = [
  { to: "/admin/server", label: "Server" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/roles", label: "Roles" },
  { to: "/admin/plugins", label: "Plugins" },
  { to: "/admin/jobs", label: "Jobs" },
  { to: "/admin/logs", label: "Logs" },
  { to: "/admin/notifications/deliveries", label: "Notification deliveries" },
] as const;

export function SettingsLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <TvIcon className="size-5" aria-hidden="true" />
          <span>Media Manager</span>
        </Link>
        <Button variant="ghost" size="sm" aria-label="Close settings" render={<Link to="/" />}>
          <XIcon className="size-4" aria-hidden="true" />
          Close
        </Button>
      </header>
      <main className="flex-1">
        <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
          <div className="flex gap-8">
            <aside className="flex w-44 shrink-0 flex-col gap-4">
              <NavGroup heading="Account" items={ACCOUNT_NAV} />
              <NavGroup heading="Admin" items={ADMIN_NAV} />
            </aside>

            <Separator orientation="vertical" />

            <div className="min-w-0 flex-1 pb-10">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavGroup({
  heading,
  items,
}: {
  heading: string;
  items: ReadonlyArray<{ to: string; label: string }>;
}) {
  return (
    <nav className="flex flex-col gap-1">
      <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: true }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors data-[status=active]:bg-muted data-[status=active]:font-medium hover:bg-muted/60"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
