import { Link, useRouterState } from "@tanstack/react-router";
import { Bookmark, Home, Library } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import * as m from "@/paraglide/messages";

type NavItem = {
  to: "/" | "/library" | "/watchlist";
  label: () => string;
  Icon: LucideIcon;
  activeOptions?: { exact: boolean };
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: () => m.home_nav_home(), Icon: Home, activeOptions: { exact: true } },
  { to: "/library", label: () => m.home_nav_library(), Icon: Library },
  { to: "/watchlist", label: () => m.home_nav_watchlist(), Icon: Bookmark },
];

function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (delta < 0) {
        setHidden(false);
        lastY = y;
      } else if (delta >= 64) {
        setHidden(y > 64);
        lastY = y;
      }
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

export function BottomNav() {
  const hidden = useHideOnScrollDown();
  const location = useRouterState({ select: (s) => s.location.pathname });
  const count = NAV_ITEMS.length;
  const idx = NAV_ITEMS.findIndex(({ to, activeOptions }) =>
    "exact" in (activeOptions ?? {}) ? location === to : location.startsWith(to),
  );

  return (
    <nav
      aria-label={m.home_nav_label_mobile()}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-out md:hidden"
      style={{
        transform: hidden ? "translateY(100%) scale(0.85)" : "translateY(0) scale(1)",
        transformOrigin: "bottom center",
        opacity: hidden ? 0 : 1,
      }}
    >
      <ul
        className="pointer-events-auto relative isolate m-0 grid w-full max-w-sm list-none grid-flow-col auto-cols-fr rounded-full bg-card/72 p-1.5"
        style={{
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          boxShadow: "var(--nav-frosted-shadow)",
        }}
      >
        {idx >= 0 && (
          <span
            aria-hidden="true"
            data-testid="nav-active-pill"
            className="pointer-events-none absolute border border-white/8 bg-white/14"
            style={{
              top: 6,
              bottom: 6,
              left: 6,
              width: `calc((100% - 12px) / ${count})`,
              borderRadius: 999,
              transform: `translateX(calc(${idx} * 100%))`,
              transition: "transform 300ms cubic-bezier(.2,.7,.2,1)",
            }}
          />
        )}
        {NAV_ITEMS.map(({ to, label, Icon, activeOptions }) => (
          <li key={to} className="flex">
            <Link
              to={to}
              activeOptions={activeOptions}
              activeProps={{ "aria-current": "page" as const }}
              className="relative z-10 flex w-full items-center justify-center gap-2 rounded-full px-3.5 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 data-[status=active]:text-foreground"
            >
              <Icon size={18} />
              <span>{label()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
