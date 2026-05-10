import type { ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CogIcon,
  LayersIcon,
  PlugIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldIcon,
  TerminalSquareIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import {
  SettingsDirtyProvider,
  useSettingsDirtyState,
} from "@/app/settings-dirty-context";

interface NavItem {
  to: string;
  label: () => string;
  intro: () => string;
  icon: LucideIcon;
  destructive?: boolean;
}

interface NavGroup {
  id: string;
  heading: () => string;
  items: ReadonlyArray<NavItem>;
}

const ACCOUNT_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: "account",
    heading: () => m.settings_group_account(),
    items: [
      {
        to: "/settings/profile",
        label: () => m.settings_nav_profile(),
        intro: () => m.settings_nav_profile_intro(),
        icon: CogIcon,
      },
      {
        to: "/settings/security",
        label: () => m.settings_nav_security(),
        intro: () => m.settings_nav_security_intro(),
        icon: ShieldIcon,
      },
    ],
  },
  {
    id: "integrations",
    heading: () => m.settings_group_integrations(),
    items: [
      {
        to: "/settings/connections",
        label: () => m.settings_nav_connections(),
        intro: () => m.settings_nav_connections_intro(),
        icon: PlugIcon,
      },
      {
        to: "/settings/apps",
        label: () => m.settings_nav_apps(),
        intro: () => m.settings_nav_apps_intro(),
        icon: LayersIcon,
      },
    ],
  },
  {
    id: "preferences",
    heading: () => m.settings_group_preferences(),
    items: [
      {
        to: "/settings/notifications",
        label: () => m.settings_nav_notifications(),
        intro: () => m.settings_nav_notifications_intro(),
        icon: BellIcon,
      },
    ],
  },
  {
    id: "danger",
    heading: () => m.settings_group_danger(),
    items: [
      {
        to: "/settings/danger",
        label: () => m.settings_nav_danger(),
        intro: () => m.settings_nav_danger_intro(),
        icon: AlertTriangleIcon,
        destructive: true,
      },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  id: "admin",
  heading: () => m.settings_group_admin(),
  items: [
    {
      to: "/admin/server",
      label: () => m.settings_nav_admin_server(),
      intro: () => m.settings_nav_admin_server_intro(),
      icon: ServerIcon,
    },
    {
      to: "/admin/users",
      label: () => m.settings_nav_admin_users(),
      intro: () => m.settings_nav_admin_users_intro(),
      icon: UsersIcon,
    },
    {
      to: "/admin/roles",
      label: () => m.settings_nav_admin_roles(),
      intro: () => m.settings_nav_admin_roles_intro(),
      icon: ShieldIcon,
    },
    {
      to: "/admin/plugins",
      label: () => m.settings_nav_admin_plugins(),
      intro: () => m.settings_nav_admin_plugins_intro(),
      icon: PlugIcon,
    },
    {
      to: "/admin/jobs",
      label: () => m.settings_nav_admin_jobs(),
      intro: () => m.settings_nav_admin_jobs_intro(),
      icon: RefreshCwIcon,
    },
    {
      to: "/admin/diagnostics",
      label: () => m.settings_nav_admin_diagnostics(),
      intro: () => m.settings_nav_admin_diagnostics_intro(),
      icon: TerminalSquareIcon,
    },
    {
      to: "/admin/notifications/deliveries",
      label: () => m.settings_nav_admin_notif_deliveries(),
      intro: () => m.settings_nav_admin_notif_deliveries_intro(),
      icon: BellIcon,
    },
    {
      to: "/admin/notifications/settings",
      label: () => m.settings_nav_admin_notif_retention(),
      intro: () => m.settings_nav_admin_notif_retention_intro(),
      icon: BellIcon,
    },
  ],
};

export function SettingsLayout() {
  return (
    <SettingsDirtyProvider>
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        <SettingsHeader />
        <main className="flex-1">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 md:grid-cols-[240px_minmax(0,1fr)] md:py-10 lg:px-6">
            <SettingsSidebar />
            <div className="min-w-0 pb-32">
              <Outlet />
            </div>
          </div>
        </main>
        <SettingsDirtyBar />
      </div>
    </SettingsDirtyProvider>
  );
}

function SettingsHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
        <span className="text-sm tracking-tight">{m.settings_title()}</span>
      </Link>
      <Button variant="ghost" size="sm" aria-label="Close settings" render={<Link to="/" />}>
        <XIcon className="size-4" aria-hidden="true" />
        Close
      </Button>
    </header>
  );
}

function SettingsSidebar() {
  // Hide the sidebar entirely on the smallest viewports — the routed page acts
  // as the drilled-in view, mirroring iOS-style settings drill-down. We still
  // render the heading so users know where they are.
  return (
    <aside className="hidden md:flex md:flex-col md:gap-5 md:py-2">
      <div className="px-2.5 text-xl font-semibold tracking-tight text-foreground">
        {m.settings_title()}
      </div>
      {[...ACCOUNT_GROUPS, ADMIN_GROUP].map((group) => (
        <SidebarGroup key={group.id} group={group} />
      ))}
    </aside>
  );
}

function SidebarGroup({ group }: { group: NavGroup }) {
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

function SidebarLink({ item }: { item: NavItem }) {
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

// ─── Dirty / sticky save bar ────────────────────────────────────────────────

function SettingsDirtyBar() {
  const { active } = useSettingsDirtyState();
  return (
    <div
      role="region"
      aria-label={m.settings_dirty_label()}
      data-open={active ? "true" : "false"}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 transition-all duration-300 ease-out",
        active ? "translate-y-0 opacity-100" : "translate-y-32 opacity-0",
      )}
    >
      {active ? (
        <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border border-border bg-card/95 py-2 pl-4 pr-2 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/20"
          />
          <div className="flex-1 truncate text-sm text-muted-foreground">{active.label}</div>
          <Button variant="ghost" size="sm" onClick={() => active.onDiscard?.()}>
            {m.settings_dirty_discard()}
          </Button>
          <Button size="sm" onClick={() => active.onSave?.()}>
            {m.settings_dirty_save()}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Page Header (consumed by sub-pages) ────────────────────────────────────

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  /** Optional pill or badge rendered next to the title. */
  status?: ReactNode;
  /** When true, shows a back link to /settings/profile. */
  showBackOnMobile?: boolean;
}

/**
 * Standard settings sub-page header. All settings pages should render this at
 * the top of their main column so spacing, type, and the mobile back-link
 * stay consistent.
 */
export function SettingsPageHeader({
  title,
  description,
  status,
  showBackOnMobile = true,
}: SettingsPageHeaderProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-6">
      {showBackOnMobile ? (
        <Link
          to="/settings/profile"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground md:hidden"
        >
          <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
          {m.settings_back_to_settings()}
        </Link>
      ) : null}
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
 * sub-headings inside a single sub-page (e.g. "Maintenance") rather than
 * for the page title.
 */
export function SettingsSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
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

// ─── Mobile drill-down list (used by /settings index on small screens) ──────

/**
 * On narrow viewports the settings hub renders a list of grouped nav items
 * that drill down to the individual sub-pages. Used by the index route which
 * redirects to /settings/profile on desktop and renders this list on mobile.
 */
export function SettingsMobileNavList() {
  return (
    <div className="flex flex-col gap-6 md:hidden">
      <header className="flex flex-col gap-1 px-1 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{m.settings_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.settings_subtitle()}</p>
      </header>
      {[...ACCOUNT_GROUPS, ADMIN_GROUP].map((group) => (
        <MobileGroup key={group.id} group={group} />
      ))}
    </div>
  );
}

function MobileGroup({ group }: { group: NavGroup }) {
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

function MobileLink({ item, withBorderTop }: { item: NavItem; withBorderTop: boolean }) {
  const Icon = item.icon;
  return (
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
      <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
