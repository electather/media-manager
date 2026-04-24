import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { Separator } from "@/components/ui/separator";

// ─── Nav ──────────────────────────────────────────────────────────────────────

const NAV = [
  { to: "/settings/profile", label: "Profile" },
  { to: "/settings/security", label: "Security" },
  { to: "/settings/apps", label: "Authorized apps" },
  { to: "/settings/danger", label: "Danger zone" },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <div>
        <h1 className="text-3xl font-semibold">Settings</h1>
      </div>

      <div className="flex gap-8">
        <nav className="flex w-44 shrink-0 flex-col gap-1">
          {NAV.map((item) => (
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

        <Separator orientation="vertical" />

        <div className="min-w-0 flex-1 pb-10">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
