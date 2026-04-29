import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";
import { APP_NAV_ITEMS } from "./nav-items";

const HIDE_THRESHOLD_PX = 200;
const REVEAL_OFFSET_PX = 64;

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
      } else if (delta >= HIDE_THRESHOLD_PX) {
        setHidden(y > REVEAL_OFFSET_PX);
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hidden = useHideOnScrollDown();

  const activeIndex = Math.max(
    0,
    APP_NAV_ITEMS.findIndex((item) =>
      item.matchPrefix
        ? pathname === item.to || pathname.startsWith(`${item.to}/`)
        : pathname === item.to,
    ),
  );

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
        "motion-reduce:transition-none!",
      )}
      style={{
        transformOrigin: "bottom center",
        transition: "transform 300ms ease-out, opacity 300ms ease-out",
        transform: hidden ? "translateY(100%) scale(0.75)" : "translateY(0) scale(1)",
        opacity: hidden ? 0 : 1,
      }}
    >
      <ul
        className={cn(
          "pointer-events-auto relative isolate grid w-full max-w-lg auto-cols-fr grid-flow-col overflow-hidden rounded-full p-1.5",
          "bg-transparent backdrop-blur-lg backdrop-saturate-200",
          "shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(255,255,255,0.08)]",
        )}
        style={{ "--active-index": activeIndex } as CSSProperties}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-linear-to-b from-white/8 via-transparent to-transparent"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-0 -z-10 h-px bg-linear-to-r from-transparent via-white/30 to-transparent"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1.5 left-1.5 w-[calc((100%-0.75rem)/var(--nav-count))] rounded-full bg-foreground/20 transition-transform duration-300 ease-out"
          style={
            {
              "--nav-count": APP_NAV_ITEMS.length,
              transform: "translateX(calc(var(--active-index) * 100%))",
            } as CSSProperties
          }
        />
        {APP_NAV_ITEMS.map((item, index) => {
          const Icon = item.icon;
          const isActive = index === activeIndex;
          return (
            <li key={item.to} className="@container flex">
              <Link
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative z-10 flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-foreground/80 transition-transform duration-150 ease-out active:scale-[0.98]",
                  "@max-[6rem]:flex-col @max-[6rem]:px-2 @max-[6rem]:py-2",
                )}
              >
                <Icon className="size-6 shrink-0" aria-hidden="true" />
                <span className="@max-[6rem]:text-xs">{item.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
