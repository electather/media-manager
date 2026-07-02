import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import type { Permission } from "@nama/shared/auth";
import { CommandMenu } from "@/features/command-menu";
import { Can } from "@/shared/components/can";
import { useHasAnyPermission } from "@/shared/hooks/use-has-any-permission";
import { useIsDesktop } from "@/shared/hooks/use-is-desktop";
import { cn } from "@/shared/lib/utils";
import { sectionTransitionClickHandler } from "@/shared/lib/view-transition";
import { BottomNav } from "./bottom-nav";
import { TopNav } from "./top-nav";

// When every item in a group is permission-gated and the user holds none of
// those permissions, the whole group (heading included) collapses out of the
// nav. Single-permission `<Can>` already hides individual items, but an
// otherwise-empty group with a lingering heading would look broken.
function useGroupIsHidden(group: SectionNavGroup): boolean {
  const itemPermissions = group.items
    .map((item) => item.permission)
    .filter((p): p is Permission => p !== undefined);
  const everyItemRequiresPermission = itemPermissions.length === group.items.length;
  const hasAny = useHasAnyPermission(itemPermissions);
  return everyItemRequiresPermission && itemPermissions.length > 0 && !hasAny;
}

export interface SectionNavItem {
  to: string;
  label: () => string;
  intro: () => string;
  icon: LucideIcon;
  destructive?: boolean;
  permission?: Permission;
}

export interface SectionNavGroup {
  id: string;
  heading: () => string;
  items: ReadonlyArray<SectionNavItem>;
}

interface SectionLayoutProps {
  title: string;
  groups: ReadonlyArray<SectionNavGroup>;
  /** Optional extra elements rendered inside the page landmark, e.g. a sticky save bar. */
  overlay?: ReactNode;
}

export function SectionLayout({ title, groups, overlay }: SectionLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      {/* Owns its own chrome so this route can control the full viewport layout
          without nesting under _app's AppShell. Mirror any root-shell changes
          (TopNav, BottomNav, CommandMenu) here too. */}
      <TopNav />
      <main className="flex-1">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 md:grid-cols-[240px_minmax(0,1fr)] md:py-10 lg:px-6">
          <SectionSidebar title={title} groups={groups} />
          <div className="min-w-0 pb-32 [view-transition-name:section-content] md:[view-transition-name:none]">
            <Outlet />
          </div>
        </div>
        {overlay}
      </main>
      <BottomNav />
      <CommandMenu />
    </div>
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
  const hidden = useGroupIsHidden(group);
  if (hidden) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="px-2.5 pb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
        {group.heading()}
      </div>
      {group.items.map((item) =>
        item.permission ? (
          <Can key={item.to} permission={item.permission}>
            <SidebarLink item={item} />
          </Can>
        ) : (
          <SidebarLink key={item.to} item={item} />
        ),
      )}
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
  const hidden = useGroupIsHidden(group);
  if (hidden) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
        {group.heading()}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
        {group.items.map((item) =>
          item.permission ? (
            <Can key={item.to} permission={item.permission}>
              <MobileLink item={item} />
            </Can>
          ) : (
            <MobileLink key={item.to} item={item} />
          ),
        )}
      </div>
    </section>
  );
}

function MobileLink({ item }: { item: SectionNavItem }) {
  const Icon = item.icon;
  const navigate = useNavigate();
  // Tanstack `Link` swallows `onClickCapture` and runs its own click handler
  // first, so wrap with a parent that intercepts the click in the capture
  // phase to start the view transition before navigation kicks off.
  const onCapture = sectionTransitionClickHandler("nav-forward", () => navigate({ to: item.to }));
  return (
    <div onClickCapture={onCapture}>
      <Link
        to={item.to}
        className={cn(
          "flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60",
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

/**
 * Section header rendered above a group of `SettingsCard`s. Use this for
 * sub-headings inside a single sub-page (e.g. "Maintenance") rather than for
 * the page title.
 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-1 pb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground/80",
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
