import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";

const navLinks = [
  { to: "/dashboard" as const, label: "Home" },
  { to: "/dashboard/discover" as const, label: "Discover" },
  { to: "/dashboard/activity" as const, label: "Activity" },
  { to: "/dashboard/requests" as const, label: "Requests" },
  { to: "/dashboard/settings" as const, label: "Settings" },
];

/** App shell with sidebar navigation used by all dashboard routes. */
export default function Layout() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    void router.navigate({ to: "/auth/login" });
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r bg-sidebar flex flex-col gap-1 p-4">
        <p className="font-semibold text-sm mb-4">ent-mcp</p>
        {navLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded px-3 py-2 text-sm hover:bg-accent"
            activeProps={{ className: "bg-accent font-medium" }}
            activeOptions={{ exact: link.to === "/dashboard" }}
          >
            {link.label}
          </Link>
        ))}
        <div className="mt-auto">
          <button
            onClick={handleSignOut}
            className="w-full rounded px-3 py-2 text-sm text-left hover:bg-accent text-muted-foreground"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
