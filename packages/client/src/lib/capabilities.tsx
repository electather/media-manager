import type { ReactNode } from "react";
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

export interface CapabilityEntry {
  id: string;
  version: string;
}

interface RenderCapabilityBadgesOptions {
  size?: "sm" | "md";
}

/**
 * Renders a flat row of capability badges. Scope is conveyed by *where* the
 * row appears (under its scope heading), not by per-badge styling — keeping
 * the visual weight identical regardless of which scope the entry belongs
 * to. `size` controls the typography density (matches the prior inline
 * styles in the modal header and admin card).
 */
export function renderCapabilityBadges(
  entries: ReadonlyArray<CapabilityEntry>,
  opts: RenderCapabilityBadgesOptions = {},
): ReactNode {
  if (entries.length === 0) return null;
  const size = opts.size ?? "md";
  const wrapperClass = size === "sm" ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-1.5";
  const badgeClass =
    size === "sm"
      ? "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
      : "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground";
  const iconClass = size === "sm" ? "size-3 opacity-60" : "size-3 opacity-60";
  return (
    <div className={wrapperClass}>
      {entries.map((cap) => {
        const { label, icon: Icon } = capabilityDisplay(cap.id);
        return (
          <span key={`${cap.id}@${cap.version}`} className={badgeClass}>
            <Icon className={iconClass} aria-hidden="true" />
            {label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Comma-separated capability label list, capped at `max`, with "+N more"
 * tail. Used for the "also provides X without a connection" muted footer
 * on the available card and the modal's secondary line.
 */
export function capabilityListSummary(entries: ReadonlyArray<CapabilityEntry>, max = 3): string {
  if (entries.length === 0) return "";
  const labels = entries.map((c) => capabilityDisplay(c.id).label);
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} +${labels.length - max} more`;
}
