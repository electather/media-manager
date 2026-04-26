import type { ComponentType, SVGProps } from "react";
import { ActivityIcon, HomeIcon, InboxIcon, LibraryIcon } from "lucide-react";

export interface NavItem {
  title: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  matchPrefix: boolean;
}

export const APP_NAV_ITEMS: NavItem[] = [
  { title: "Home", to: "/", icon: HomeIcon, matchPrefix: false },
  { title: "Library", to: "/library", icon: LibraryIcon, matchPrefix: true },
  { title: "Requests", to: "/requests", icon: InboxIcon, matchPrefix: true },
  { title: "Activity", to: "/activity", icon: ActivityIcon, matchPrefix: true },
];
