import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import type { SeasonInfo } from "@ent-mcp/shared/home";
import { RequestableSeasons } from "@/features/request-flow/components/requestable-seasons";
import type { Season } from "@/features/request-flow/lib/types";
import { joinSeasonAvailability } from "./derive-status";
import { useSeasonAvailability } from "./use-season-availability";

type Props = {
  tmdbId: string;
  itemTitle: string;
  seasons: SeasonInfo[];
};

/**
 * Joins canonical `SeasonInfo[]` with the per-server availability response,
 * filters specials with no presence, and renders the existing
 * `RequestableSeasons` accordion in read-only mode (`pluginConfigured=false`).
 *
 * Per-plugin failures arrive as `errors[]` on the response and render as
 * single-line "{server} unreachable" hints alongside the surviving servers.
 * Boundary-level failures are caught by the parent `<ErrorBoundary>`.
 */
export function SeasonsList({ tmdbId, itemTitle, seasons }: Props) {
  const { data } = useSeasonAvailability(tmdbId);
  const joined = useMemo<Season[]>(
    () => joinSeasonAvailability(seasons, data.servers),
    [seasons, data.servers],
  );

  const errorChips = data.errors?.length ? (
    <>
      {data.errors.map((err) => (
        <p
          key={err.serverId}
          role="status"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {m.home_detail_seasons_server_unreachable({ server: err.serverLabel })}
        </p>
      ))}
    </>
  ) : null;

  // Specials-only show with no server presence collapses `joined` to empty.
  // Still surface error chips so the user sees "{server} unreachable" rather
  // than a blank section — silent emptiness was the regression flagged in
  // PR #202 review (early `return null` swallowed `data.errors`).
  if (joined.length === 0) {
    if (!errorChips) return null;
    return <div className="flex flex-col gap-2">{errorChips}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {errorChips}
      {data.servers.length === 0 && (data.errors?.length ?? 0) === 0 ? (
        <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          {m.home_detail_seasons_no_servers()}
        </p>
      ) : null}
      <RequestableSeasons
        itemId={tmdbId}
        itemTitle={itemTitle}
        seasons={joined}
        pluginConfigured={false}
      />
    </div>
  );
}
