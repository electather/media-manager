import type { RequestRole } from "../lib/types";

interface RequestableSeasonsListProps {
  item: { id: string; kind: "movie" | "tv"; title: string };
  role: RequestRole;
  defaultServiceId: string;
  defaultProfileId: string;
  pluginConfigured: boolean;
  initialOverrides: Record<string, unknown>;
}

// Stub: real impl wires to seasons mock + per-season request mutations.
export function RequestableSeasonsList(_props: RequestableSeasonsListProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-xs text-muted-foreground">
      RequestableSeasonsList stub — per-season requests land in T44.
    </div>
  );
}
