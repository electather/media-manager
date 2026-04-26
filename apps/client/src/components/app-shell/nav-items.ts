import type { ComponentType, SVGProps } from "react";
import { ClockIcon, CircleUserRoundIcon, DownloadIcon, HomeIcon, SparklesIcon } from "lucide-react";

export interface NavItem {
  title: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  matchPrefix: boolean;
}

export const APP_NAV_ITEMS: NavItem[] = [
  { title: "Home", to: "/", icon: HomeIcon, matchPrefix: false },
  { title: "Activity", to: "/activity", icon: ClockIcon, matchPrefix: true },
  { title: "Requests", to: "/requests", icon: DownloadIcon, matchPrefix: true },
  { title: "Taste", to: "/taste", icon: SparklesIcon, matchPrefix: true },
  { title: "Profile", to: "/profile", icon: CircleUserRoundIcon, matchPrefix: true },
];
