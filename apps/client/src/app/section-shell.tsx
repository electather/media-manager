import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { useRef, useSyncExternalStore, type ReactNode } from "react";

import { AppShell } from "@/app/app-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import { cn } from "@/shared/lib/utils";
import { sectionTransitionClickHandler } from "@/shared/lib/view-transition";

export interface SectionNavItem {
  to: string;
  label: () => string;
  intro: () => string;
  icon: LucideIcon;
  destructive?: boolean;
}

export interface SectionNavGroup {
  id: string;
  heading: () => string;
  items: ReadonlyArray<SectionNavItem>;
}

const DESKTOP_QUERY = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  const mqRef = useRef<MediaQueryList | null>(null);
  return useSyncExternalStore(
    (cb) => {
      mqRef.current = window.matchMedia(DESKTOP_QUERY);
      mqRef.current.addEventListener("change", cb);
      return () => mqRef.current?.removeEventListener("change", cb);
    },
    () => (mqRef.current ?? window.matchMedia(DESKTOP_QUERY)).matches,
    () => false,
  );
}

interface SectionLayoutProps {
  title: string;
  groups: ReadonlyArray<SectionNavGroup>;
  /** Optional extra elements rendered alongside the shell, e.g. a sticky save bar. */
  overlay?: ReactNode;
}

export function SectionLayout({ title, groups, overlay }: SectionLayoutProps) {
  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 md:grid-cols-[240px_minmax(0,1fr)] md:py-10 lg:px-6">
        <SectionSidebar title={title} groups={groups} />
        <div className="min-w-0 pb-32 [view-transition-name:section-content] md:[view-transition-name:none]">
          <Outlet />
        </div>
      </div>
      {overlay}
    </AppShell>
  );
}

function SectionSidebar({
  title,
  groups,
}: {
  title: string;
  groups: ReadonlyArray<SectionNavGroup>;
}) {
  // Hide the sidebar entirely on the smallest viewports — the routed page acts
  // as the drilled-in view, mirroring iOS-style settings drill-down. The
  // section index renders the mobile drill-down list when the sidebar is
  // hidden.
  return (
    <aside className="hidden md:flex md:flex-col md:gap-5 md:py-2">
      <div className="px-2.5 text-xl font-semibold tracking-tight text-foreground">{title}</div>
      {groups.map((group) => (
        <SidebarGroup key={group.id} group={group} />
      ))}
    </aside>
  );
}

function SidebarGroup({ group }: { group: SectionNavGroup }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-2.5 pb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
        {group.heading()}
      </div>
      {group.items.map((item) => (
        <SidebarLink key={item.to} item={item} />
      ))}
    </div>
  );
}

function SidebarLink({ item }: { item: SectionNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      className={cn(
        "group/sidebar-link flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        "data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-foreground",
        item.destructive &&
          "text-destructive/80 hover:bg-destructive/10 hover:text-destructive data-[status=active]:bg-destructive/10 data-[status=active]:text-destructive",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label()}</span>
    </Link>
  );
}

export function SectionMobileNavList({
  title,
  subtitle,
  groups,
}: {
  title: string;
  subtitle?: string;
  groups: ReadonlyArray<SectionNavGroup>;
}) {
  return (
    <div className="flex flex-col gap-6 md:hidden">
      <header className="flex flex-col gap-1 px-1 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      {groups.map((group) => (
        <MobileGroup key={group.id} group={group} />
      ))}
    </div>
  );
}

function MobileGroup({ group }: { group: SectionNavGroup }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
        {group.heading()}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {group.items.map((item, i) => (
          <MobileLink key={item.to} item={item} withBorderTop={i > 0} />
        ))}
      </div>
    </section>
  );
}

function MobileLink({ item, withBorderTop }: { item: SectionNavItem; withBorderTop: boolean }) {
  const Icon = item.icon;
  const navigate = useNavigate();
  // Tanstack `Link` swallows `onClickCapture` and runs its own click handler
  // first, so wrap with a parent that intercepts the click in the capture
  // phase to start the view transition before navigation kicks off.
  const onCapture = sectionTransitionClickHandler("nav-forward", () => navigate({ to: item.to }));
  return (
    <div onClickCapture={onCapture} style={{ display: "contents" }}>
      <Link
        to={item.to}
        className={cn(
          "flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60",
          withBorderTop && "border-t border-border",
          item.destructive && "text-destructive",
        )}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{item.label()}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{item.intro()}</div>
        </div>
        <ChevronRightIcon
          className="mt-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </div>
  );
}

interface SectionPageHeaderProps {
  title: string;
  description?: string;
  status?: ReactNode;
  /** Where the mobile back link points (the section index, e.g. /settings or /admin). */
  backTo: string;
  /** Visible label for the back link. */
  backLabel: string;
}

/**
 * Standard section sub-page header. Keeps title, description, and the mobile
 * breadcrumb consistent across all settings and admin sub-pages.
 */
export function SectionPageHeader({
  title,
  description,
  status,
  backTo,
  backLabel,
}: SectionPageHeaderProps) {
  const navigate = useNavigate();
  const onBackClick = sectionTransitionClickHandler("nav-back", () => navigate({ to: backTo }));
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-6">
      <Breadcrumb className="md:hidden">
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem onClickCapture={onBackClick}>
            <BreadcrumbLink render={<Link to={backTo} />}>{backLabel}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {status}
      </div>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}

/**
 * Section header rendered above a group of `SettingsCard`s. Use this for
 * sub-headings inside a single sub-page (e.g. "Maintenance") rather than for
 * the page title.
 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-1 pb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Renders the mobile drill-down list at narrow widths and redirects to a
 * default sub-page on desktop where the sidebar already exposes everything.
 */
export function SectionIndex({
  title,
  subtitle,
  groups,
  desktopRedirectTo,
}: {
  title: string;
  subtitle?: string;
  groups: ReadonlyArray<SectionNavGroup>;
  desktopRedirectTo: string;
}) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return <Navigate to={desktopRedirectTo} replace />;
  }
  return <SectionMobileNavList title={title} subtitle={subtitle} groups={groups} />;
}
