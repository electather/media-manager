import { SearchIcon, PlusIcon } from "lucide-react";

import { m } from "@/paraglide/messages";

import { Button } from "@/shared/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group";
import { cn } from "@/shared/lib/utils";

import type { PluginListFilter } from "../shared/types";

interface FilterCounts {
  all: number;
  enabled: number;
  disabled: number;
  user: number;
  metadata: number;
}

interface FilterBarProps {
  filter: PluginListFilter;
  onFilterChange: (value: PluginListFilter) => void;
  query: string;
  onQueryChange: (value: string) => void;
  counts: FilterCounts;
  /** When false the Install CTA is hidden — third-party install requires the sandbox. */
  canInstall: boolean;
  onInstall: () => void;
}

export function FilterBar({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  counts,
  canInstall,
  onInstall,
}: FilterBarProps) {
  const chips: ReadonlyArray<{ id: PluginListFilter; label: string }> = [
    { id: "all", label: m.admin_plugins_filter_all() },
    { id: "enabled", label: m.admin_plugins_filter_enabled() },
    { id: "disabled", label: m.admin_plugins_filter_disabled() },
    { id: "user", label: m.admin_plugins_filter_user() },
    { id: "metadata", label: m.admin_plugins_filter_metadata() },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => onFilterChange(chip.id)}
              data-active={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-border bg-muted text-foreground"
                  : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {chip.label}
              <span
                className={cn(
                  "font-mono text-[10.5px]",
                  active ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {counts[chip.id]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-w-45 flex-1">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={m.admin_plugins_filter_placeholder()}
            aria-label={m.admin_plugins_filter_aria()}
          />
        </InputGroup>
      </div>
      {canInstall ? (
        <Button size="sm" onClick={onInstall}>
          <PlusIcon /> {m.admin_plugins_install_cta()}
        </Button>
      ) : null}
    </div>
  );
}
