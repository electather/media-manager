import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import type { AuthorizedAppsFilter } from "../lib/types";

interface ClientFiltersProps {
  filter: AuthorizedAppsFilter;
  setFilter: (next: AuthorizedAppsFilter) => void;
  counts: Record<AuthorizedAppsFilter, number>;
}

export function ClientFilters({ filter, setFilter, counts }: ClientFiltersProps) {
  const filters: ReadonlyArray<{ id: AuthorizedAppsFilter; label: string; count: number }> = [
    { id: "all", label: m.settings_apps_filter_all(), count: counts.all },
    { id: "active", label: m.settings_apps_filter_active(), count: counts.active },
    { id: "new", label: m.settings_apps_filter_new(), count: counts.new },
    { id: "idle", label: m.settings_apps_filter_idle(), count: counts.idle },
  ];

  return (
    <div className="flex gap-1.5" role="group" aria-label={m.settings_apps_filter_aria()}>
      {filters.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={filter === item.id}
          onClick={() => setFilter(item.id)}
          data-testid={`filter-${item.id}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            filter === item.id
              ? "border-input bg-muted text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {item.label}
          <span className="font-mono text-[10px] text-muted-foreground/80">{item.count}</span>
        </button>
      ))}
    </div>
  );
}
