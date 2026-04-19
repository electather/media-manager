import * as React from "react";
import { Link } from "@tanstack/react-router";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  HomeIcon,
  PlugIcon,
  ClockIcon,
  DownloadIcon,
  SparklesIcon,
  Settings2Icon,
  UsersIcon,
  ShieldIcon,
  ServerIcon,
  TvIcon,
  BoxIcon,
} from "lucide-react";

const navMain = [
  { title: "Home", to: "/", icon: <HomeIcon />, matchPrefix: false },
  { title: "Connections", to: "/connections", icon: <PlugIcon />, matchPrefix: true },
  { title: "Activity", to: "/activity", icon: <ClockIcon />, matchPrefix: true },
  { title: "Requests", to: "/requests", icon: <DownloadIcon />, matchPrefix: true },
  { title: "Taste Profile", to: "/profile", icon: <SparklesIcon />, matchPrefix: true },
];

const navAdmin = [
  { title: "Users", to: "/admin/users", icon: <UsersIcon />, matchPrefix: true },
  { title: "Roles", to: "/admin/roles", icon: <ShieldIcon />, matchPrefix: true },
  { title: "Plugins", to: "/admin/plugins", icon: <BoxIcon />, matchPrefix: true },
  { title: "Server", to: "/admin/server", icon: <ServerIcon />, matchPrefix: true },
];

const navSecondary = [{ title: "Settings", to: "/settings", icon: <Settings2Icon /> }];

/** Placeholder user — replace with session data once auth is wired. */
const placeholderUser = {
  name: "User",
  email: "",
  avatar: "",
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link to="/" />}
            >
              <TvIcon className="size-5!" />
              <span className="text-base font-semibold">Media Manager</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        {/* Admin section — rendered for all users for now; gate on admin:* permission once RBAC is in place. */}
        <NavMain label="Admin" items={navAdmin} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={placeholderUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
