import * as m from "@/paraglide/messages";

/**
 * Fallback rendered when the suspense query for `home.getSeasonAvailability`
 * itself rejects (network outage, 500). Per-plugin failures arrive in
 * `errors[]` on a successful response and are rendered inline by
 * `SeasonsList` rather than triggering this boundary.
 */
export function SeasonsError() {
  return (
    <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      {m.home_detail_seasons_error()}
    </p>
  );
}
