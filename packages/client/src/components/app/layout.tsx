import { Link, Outlet } from "@tanstack/react-router";

const navLinks = [
  { to: "/", label: "Home" },
  { to: "/discover", label: "Discover" },
  { to: "/activity", label: "Activity" },
  { to: "/requests", label: "Requests" },
  { to: "/settings", label: "Settings" },
] as const;

/** Root app shell with sidebar navigation and main content area. */
export default function Layout() {
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
          >
            {link.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
