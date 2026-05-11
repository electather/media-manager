import { ChevronRightIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { m } from "@/paraglide/messages";

import { Badge } from "@/shared/ui/badge";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/utils";

import { PluginIcon } from "../shared/plugin-icon";
import { StatusDot } from "../shared/status-dot";
import { pluginPurity, type PluginRow } from "../shared/types";

interface PluginRowItemProps {
  plugin: PluginRow;
  onToggle: (next: boolean) => void;
  toggling: boolean;
}

function purityLabel(p: ReturnType<typeof pluginPurity>): { label: string; tone: string } | null {
  if (p === "user")
    return {
      label: m.admin_plugins_row_purity_user(),
      tone: "border-sky-500/40 bg-sky-500/10 text-sky-500",
    };
  if (p === "global")
    return {
      label: m.admin_plugins_row_purity_global(),
      tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
    };
  return {
    label: m.admin_plugins_row_purity_mixed(),
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  };
}

// fallow-ignore-next-line complexity
export function PluginRowItem({ plugin, onToggle, toggling }: PluginRowItemProps) {
  const userCaps = plugin.capabilities.filter((c) => c.scope === "user").length;
  const globalCaps = plugin.capabilities.filter((c) => c.scope === "global").length;
  const purity = purityLabel(pluginPurity(plugin));
  const poolTotal = plugin.sharedCredentialsCount;
  const poolEnabled = plugin.sharedCredentialsEnabledCount;
  const disabled = !plugin.enabled;

  return (
    <div
      className={cn(
        "group grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4",
        "border-t border-border first:border-t-0",
        "transition-colors hover:bg-muted/50",
      )}
    >
      <Link
        to="/admin/plugins/$pluginId"
        params={{ pluginId: plugin.id }}
        aria-label={m.admin_plugins_row_open_aria({ name: plugin.manifest.name })}
        className="flex min-w-0 items-center gap-3 sm:gap-4"
      >
        <PluginIcon plugin={plugin} size={40} />
      </Link>
      <Link
        to="/admin/plugins/$pluginId"
        params={{ pluginId: plugin.id }}
        className="min-w-0 outline-none focus-visible:underline"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tracking-tight text-foreground">
            {plugin.manifest.name}
          </span>
          <span className="font-mono text-[11.5px] text-muted-foreground/80">
            v{plugin.version}
          </span>
          {plugin.isBuiltin ? (
            <Badge variant="secondary" className="text-[11px] font-normal">
              {m.admin_plugins_row_builtin()}
            </Badge>
          ) : null}
          {purity ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                purity.tone,
              )}
            >
              {purity.label}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={disabled ? "disabled" : "ok"} size={7} />
            {disabled ? m.admin_plugins_row_disabled() : m.admin_plugins_row_enabled()}
          </span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
          <span>
            {userCaps === 1
              ? m.admin_plugins_row_caps_one({ global: globalCaps, user: userCaps })
              : m.admin_plugins_row_caps_many({ global: globalCaps, user: userCaps })}
          </span>
          {poolTotal > 0 ? (
            <>
              <span className="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span className="font-mono">
                {m.admin_plugins_row_pool({ enabled: poolEnabled, total: poolTotal })}
              </span>
            </>
          ) : null}
        </div>
      </Link>
      <Switch
        checked={plugin.enabled}
        onCheckedChange={onToggle}
        disabled={toggling}
        aria-label={
          plugin.enabled
            ? m.admin_plugins_row_disable_aria({ name: plugin.manifest.name })
            : m.admin_plugins_row_enable_aria({ name: plugin.manifest.name })
        }
      />
      <Link
        to="/admin/plugins/$pluginId"
        params={{ pluginId: plugin.id }}
        aria-label={m.admin_plugins_row_open_aria({ name: plugin.manifest.name })}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
