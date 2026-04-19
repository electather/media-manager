import {
  BookmarkIcon,
  CalendarIcon,
  DownloadIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  PlugIcon,
  SparklesIcon,
  StarIcon,
  type LucideIcon,
} from "lucide-react";

interface CapabilityDisplay {
  label: string;
  icon: LucideIcon;
}

export const CAPABILITY_DISPLAY: Record<string, CapabilityDisplay> = {
  watchHistory: { label: "Watch History", icon: HistoryIcon },
  watchlist: { label: "Watchlist", icon: BookmarkIcon },
  ratings: { label: "Ratings", icon: StarIcon },
  recommendations: { label: "Recommendations", icon: SparklesIcon },
  calendar: { label: "Calendar", icon: CalendarIcon },
  metadata: { label: "Metadata", icon: InfoIcon },
  mediaRequest: { label: "Media Requests", icon: DownloadIcon },
  idResolve: { label: "ID Resolution", icon: LinkIcon },
};

// Unknown ids fall back to a titleized label and a generic plug icon so the page never breaks
// when a plugin declares a capability the host hasn't mapped yet.
function titleize(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function capabilityDisplay(id: string): CapabilityDisplay {
  return CAPABILITY_DISPLAY[id] ?? { label: titleize(id), icon: PlugIcon };
}
