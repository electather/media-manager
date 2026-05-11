import { ChevronLeftIcon, BadgeCheckIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

import { PluginIcon } from "../shared/plugin-icon";
import type { PluginRow } from "../shared/types";

interface PluginDetailHeaderProps {
  plugin: PluginRow;
  onToggle: (next: boolean) => void;
  toggling: boolean;
  onUninstall: () => void;
}

function formatInstalled(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// fallow-ignore-next-line complexity
export function PluginDetailHeader({
  plugin,
  onToggle,
  toggling,
  onUninstall,
}: PluginDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 self-start text-muted-foreground hover:text-foreground"
        render={<Link to="/admin/plugins" />}
      >
        <ChevronLeftIcon /> All plugins
      </Button>
      <div className="flex flex-wrap items-start gap-4">
        <PluginIcon plugin={plugin} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{plugin.manifest.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">v{plugin.version}</span>
            {plugin.isBuiltin ? (
              <Badge variant="secondary" className="text-xs font-normal">
                <BadgeCheckIcon /> Built-in
              </Badge>
            ) : null}
            {!plugin.enabled ? (
              <Badge variant="outline" className="text-xs font-normal">
                Disabled
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {plugin.manifest.author ? `By ${plugin.manifest.author.name} · ` : null}
            Installed {formatInstalled(plugin.installedAt)}
          </p>
          {plugin.manifest.description ? (
            <p className="mt-2 max-w-[72ch] text-sm text-muted-foreground">
              {plugin.manifest.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {plugin.enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={onToggle}
            disabled={toggling}
            aria-label={plugin.enabled ? "Disable plugin" : "Enable plugin"}
          />
        </div>
      </div>
      {!plugin.isBuiltin ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-muted-foreground">
          <span>Uninstalling removes this plugin and all of its user connections.</span>
          <Button variant="outline" size="sm" onClick={onUninstall}>
            Uninstall…
          </Button>
        </div>
      ) : null}
    </div>
  );
}
