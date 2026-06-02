import { forwardRef, type AnchorHTMLAttributes, type ComponentProps } from "react";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import { cn } from "@/shared/lib/utils";

const ROUTE_TAB_CLASS = cn(
  "group flex flex-col items-start gap-1 rounded-md px-3 py-2.5 text-start transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "text-muted-foreground hover:text-foreground",
  "data-[status=active]:bg-accent data-[status=active]:text-accent-foreground",
);

interface RouteTabBaseProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Primary tab label. */
  title: string;
  /** Mono uppercase note rendered beneath the title. */
  subtitle: string;
}

const RouteTabBase = forwardRef<HTMLAnchorElement, RouteTabBaseProps>(
  ({ title, subtitle, className, ...props }, ref) => (
    <a ref={ref} className={cn(ROUTE_TAB_CLASS, className)} {...props}>
      <span className="text-sm font-medium leading-none">{title}</span>
      <span className="font-mono text-[0.5625rem] uppercase tracking-wider leading-none text-muted-foreground/70 group-data-[status=active]:text-primary">
        {subtitle}
      </span>
    </a>
  ),
);
RouteTabBase.displayName = "RouteTabBase";

const RouteTabLink = createLink(RouteTabBase);

/**
 * One router-driven tab: a type-safe `<Link>` styled as a two-line segmented
 * cell (title + uppercase subtitle). Active state derives from the router's
 * `data-status=active` attribute — with `includeSearch: false` so a query-param
 * change (e.g. a sort flip) never drops the active mark — keeping it in sync
 * with deep links and back/forward without a duplicate piece of state.
 *
 * These navigate to independent routes rather than toggling tabpanels, so the
 * active link is marked `aria-current="page"` — the navigation idiom — instead
 * of the `role=tab`/`aria-selected` widget pattern, which expects an associated
 * `role=tabpanel` that doesn't exist here.
 */
export const RouteTab: LinkComponent<typeof RouteTabBase> = (props) => (
  <RouteTabLink
    activeOptions={{ exact: true, includeSearch: false }}
    activeProps={{ "aria-current": "page" as const }}
    {...props}
  />
);

/**
 * The shared segmented tab strip — a `role=navigation` landmark framing a row
 * of `<RouteTab>` links (callers pass an `aria-label` to name it). The library
 * lens switcher and the watchlist bucket filter both compose this so the two
 * pages read identically. Wraps when the tabs outgrow one line.
 */
export function RouteTabs({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="navigation"
      className={cn("inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1", className)}
      {...props}
    />
  );
}
