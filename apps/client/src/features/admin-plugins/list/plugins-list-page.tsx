import { useMemo, useState } from "react";

import { m } from "@/paraglide/messages";

import { Card } from "@/shared/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty";

import { FilterBar } from "./filter-bar";
import { InstallDialog } from "./install-dialog";
import { PluginRowItem } from "./plugin-row";
import { usePlugins } from "./use-plugins";
import { useTogglePlugin } from "./use-toggle-plugin";
import type { PluginListFilter, PluginRow } from "../shared/types";
import { pluginPurity } from "../shared/types";

// fallow-ignore-next-line complexity
function applyFilter(rows: PluginRow[], filter: PluginListFilter, query: string): PluginRow[] {
  let list = rows;
  if (filter === "enabled") list = list.filter((p) => p.enabled);
  if (filter === "disabled") list = list.filter((p) => !p.enabled);
  if (filter === "user") list = list.filter((p) => pluginPurity(p) !== "global");
  if (filter === "metadata") list = list.filter((p) => pluginPurity(p) !== "user");
  const q = query.trim().toLowerCase();
  if (q.length > 0) {
    list = list.filter(
      (p) =>
        p.manifest.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.manifest.description ?? "").toLowerCase().includes(q),
    );
  }
  return list;
}

// fallow-ignore-next-line complexity
export function PluginsListPage() {
  const { data: plugins } = usePlugins();
  const toggle = useTogglePlugin();
  const [filter, setFilter] = useState<PluginListFilter>("all");
  const [query, setQuery] = useState("");
  // Dormant: canInstall={false} hides CTA; sandboxAvailable={false} keeps dialog disabled.
  // Set canInstall={true} and sandboxAvailable={true} when QuickJS sandbox lands — state, handler, and dialog are intentionally preserved.
  const [installOpen, setInstallOpen] = useState(false);

  const counts = useMemo(
    () => ({
      all: plugins.length,
      enabled: plugins.filter((p) => p.enabled).length,
      disabled: plugins.filter((p) => !p.enabled).length,
      user: plugins.filter((p) => pluginPurity(p) !== "global").length,
      metadata: plugins.filter((p) => pluginPurity(p) !== "user").length,
    }),
    [plugins],
  );

  const filtered = useMemo(() => applyFilter(plugins, filter, query), [plugins, filter, query]);

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">{m.admin_plugins_list_title()}</h1>
        <p className="max-w-[64ch] text-sm text-muted-foreground">
          {m.admin_plugins_list_description()}
        </p>
      </header>

      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        counts={counts}
        // Third-party plugin install requires the QuickJS sandbox, which is not
        // yet available. Hide the CTA until the capability lands.
        canInstall={false}
        onInstall={() => setInstallOpen(true)}
      />

      {plugins.length === 0 ? (
        <Card className="gap-0 overflow-hidden p-0">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>{m.admin_plugins_list_empty_title()}</EmptyTitle>
              <EmptyDescription>{m.admin_plugins_list_empty_description()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="gap-0 overflow-hidden p-0">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>{m.admin_plugins_list_no_matches_title()}</EmptyTitle>
              <EmptyDescription>{m.admin_plugins_list_no_matches_description()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          {filtered.map((plugin) => (
            <PluginRowItem
              key={plugin.id}
              plugin={plugin}
              toggling={toggle.isPending && toggle.variables?.pluginId === plugin.id}
              onToggle={(enabled) => toggle.mutate({ pluginId: plugin.id, enabled })}
            />
          ))}
        </Card>
      )}

      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} sandboxAvailable={false} />
    </div>
  );
}
