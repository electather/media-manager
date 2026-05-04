import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as m from "@/paraglide/messages";

const NAV_ITEMS = [
  { to: "/" as const, label: () => m.home_nav_home(), activeOptions: { exact: true } },
  { to: "/library" as const, label: () => m.home_nav_library() },
  { to: "/watchlist" as const, label: () => m.home_nav_watchlist() },
];

export function TopNavLinks() {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[data-status="active"]');
      if (!active) return;
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setPill({ left: activeRect.left - navRect.left, width: activeRect.width, ready: true });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [location]);

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className="relative isolate hidden items-center gap-0.5 md:flex"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 rounded-lg border border-white/8 bg-white/14"
        style={{
          left: pill.left,
          width: pill.width,
          opacity: pill.ready ? 1 : 0,
          transition: pill.ready
            ? "left 300ms cubic-bezier(.2,.7,.2,1), width 300ms cubic-bezier(.2,.7,.2,1), opacity 150ms ease"
            : "none",
        }}
      />
      {NAV_ITEMS.map(({ to, label, activeOptions }) => (
        <Link
          key={to}
          to={to}
          activeOptions={activeOptions}
          activeProps={{ "aria-current": "page" as const }}
          className="relative z-10 flex items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors duration-150 data-[status=active]:font-medium data-[status=active]:text-foreground"
        >
          {label()}
        </Link>
      ))}
    </nav>
  );
}
