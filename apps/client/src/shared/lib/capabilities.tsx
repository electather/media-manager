import {
  BookmarkIcon,
  CalendarIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FilmIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  LibraryBigIcon,
  LinkIcon,
  MessageSquareIcon,
  MonitorPlayIcon,
  PlayIcon,
  PlugIcon,
  RewindIcon,
  SparklesIcon,
  StarIcon,
  TvIcon,
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
  libraryAvailability: { label: "Library Availability", icon: CheckCircle2Icon },
  libraryAdmin: { label: "Library Admin", icon: LibraryBigIcon },
  playback: { label: "Playback", icon: PlayIcon },
  playbackSessions: { label: "Playback Sessions", icon: MonitorPlayIcon },
  continueWatching: { label: "Continue Watching", icon: RewindIcon },
  watchProviders: { label: "Watch Providers", icon: TvIcon },
  trailers: { label: "Trailers", icon: FilmIcon },
  userComments: { label: "User Comments", icon: MessageSquareIcon },
  collection: { label: "Collection", icon: LayersIcon },
  // New plugin-declared capabilities should be added here. Unmapped ids still
  // render via `capabilityDisplay`'s titleize + PlugIcon fallback so the page
  // never breaks.
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

interface CapabilityBadgesProps {
  entries: ReadonlyArray<CapabilityEntry>;
  /**
   * Typography density. `sm` matches the modal header / admin card density;
   * `md` matches the connection card. Scope is conveyed by *where* the row
   * appears (under its scope heading), never by per-badge styling.
   */
  size?: "sm" | "md";
}

/**
 * Flat row of capability badges. Renders nothing when `entries` is empty.
 */
export function CapabilityBadges({ entries, size = "md" }: CapabilityBadgesProps) {
  if (entries.length === 0) return null;
  const badgeClass =
    size === "sm"
      ? "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      : "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground";
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((cap) => {
        const { label, icon: Icon } = capabilityDisplay(cap.id);
        return (
          <span key={`${cap.id}@${cap.version}`} className={badgeClass}>
            <Icon className="size-3 opacity-60" aria-hidden="true" />
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
