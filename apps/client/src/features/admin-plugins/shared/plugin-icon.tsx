import { cn } from "@/shared/lib/utils";

import type { PluginRow } from "./types";

interface PluginIconProps {
  plugin: Pick<PluginRow, "id" | "manifest">;
  size?: number;
  className?: string;
}

// fallow-ignore-next-line complexity
function initialsFor(pluginId: string, name: string): string {
  if (pluginId && pluginId.length >= 2) return pluginId.slice(0, 2).toLowerCase();
  if (name && name.length >= 2) return name.slice(0, 2).toLowerCase();
  return "??";
}

const TONE_BY_ID: Record<string, string> = {
  tmdb: "oklch(0.55 0.14 220)",
  tvdb: "oklch(0.50 0.13 145)",
  trakt: "oklch(0.55 0.18 25)",
  jellyfin: "oklch(0.52 0.15 285)",
  radarr: "oklch(0.58 0.16 50)",
  plex: "oklch(0.62 0.17 90)",
  sonarr: "oklch(0.55 0.14 200)",
  ntfy: "oklch(0.55 0.16 145)",
  telegram: "oklch(0.65 0.13 240)",
  discord: "oklch(0.52 0.14 285)",
  webhook: "oklch(0.55 0.13 30)",
  seerr: "oklch(0.55 0.14 320)",
  fanart: "oklch(0.55 0.13 60)",
};

function toneFor(pluginId: string): string {
  return TONE_BY_ID[pluginId] ?? "oklch(0.42 0.04 260)";
}

export function PluginIcon({ plugin, size = 40, className }: PluginIconProps) {
  const tone = toneFor(plugin.id);
  const initials = initialsFor(plugin.id, plugin.manifest.name);
  const logoUrl = plugin.manifest.logoUrl;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-background/30 font-mono font-semibold text-foreground/95 tracking-[-0.02em] shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_1px_2px_oklch(0_0_0/0.4)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: logoUrl
          ? undefined
          : `linear-gradient(145deg, oklch(from ${tone} calc(l + 0.05) c h), ${tone})`,
        fontSize: size * 0.36,
      }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="size-full object-contain"
          loading="lazy"
        />
      ) : (
        initials
      )}
    </div>
  );
}
