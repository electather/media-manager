import {
  BellIcon,
  PlugIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldIcon,
  TerminalSquareIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages";

import {
  SectionIndex,
  SectionLayout,
  SectionPageHeader,
  type SectionNavGroup,
} from "@/app/section-shell";

const ADMIN_GROUPS: ReadonlyArray<SectionNavGroup> = [
  {
    id: "general",
    heading: () => m.admin_group_general(),
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
    ],
  },
  {
    id: "notifications",
    heading: () => m.admin_group_notifications(),
    items: [
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
  },
];

export function AdminLayout() {
  return <SectionLayout title={m.admin_title()} groups={ADMIN_GROUPS} />;
}

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  status?: ReactNode;
}

/**
 * Admin sub-page header — thin wrapper around `SectionPageHeader` with the
 * back link pointing to the admin index.
 */
export function AdminPageHeader({ title, description, status }: AdminPageHeaderProps) {
  return (
    <SectionPageHeader
      title={title}
      description={description}
      status={status}
      backTo="/admin"
      backLabel={m.admin_back_to_admin()}
    />
  );
}

export function AdminIndex() {
  return (
    <SectionIndex
      title={m.admin_title()}
      subtitle={m.admin_subtitle()}
      groups={ADMIN_GROUPS}
      desktopRedirectTo="/admin/server"
    />
  );
}
