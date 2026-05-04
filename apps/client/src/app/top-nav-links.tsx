import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import * as m from "@/paraglide/messages";
import { NAV_ITEMS, useActiveNavIndex } from "./nav-items";
import { NavPill } from "./nav-pill";

export function TopNavLinks() {
  const activeIdx = useActiveNavIndex();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[data-status="active"]');
      if (!active) {
        setPill((p) => ({ ...p, ready: false }));
        return;
      }
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setPill({ left: activeRect.left - navRect.left, width: activeRect.width, ready: true });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeIdx]);

  return (
    <nav
      ref={navRef}
      aria-label={m.home_nav_label_primary()}
      className="relative isolate hidden items-center gap-0.5 md:flex"
    >
      <NavPill
        className="inset-y-0 rounded-lg"
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
          className="relative z-10 flex items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 data-[status=active]:text-foreground"
        >
          {label()}
        </Link>
      ))}
    </nav>
  );
}
