import * as m from "@/paraglide/messages";
import type { MatchReason, MatchReasonKey } from "@ent-mcp/shared/home";

type Props = {
  reason: MatchReason | undefined;
};

/**
 * Local resolver for the modal's match-reason chip. Mirrors the home
 * feature's `MATCH_REASON_COPY` map but stays inside the modal package so
 * the shared `media-detail-modal` zone has no upward import into
 * `features/home` — the chip surface is small enough that duplicating the
 * dispatch table here is cheaper than introducing a fourth shared layer.
 */
const COPY: Record<MatchReasonKey, (params: Record<string, string>) => string> = {
  matches_recent_picks: (p) => m.home_match_reason_matches_recent_picks({ n: p.n ?? "" }),
  from_genre_you_love: (p) => m.home_match_reason_from_genre_you_love({ genre: p.genre ?? "" }),
  similar_to_seed: (p) => m.home_match_reason_similar_to_seed({ seedTitle: p.seedTitle ?? "" }),
  because_in_watchlist: () => m.home_match_reason_because_in_watchlist(),
  continuing_series: () => m.home_match_reason_continuing_series(),
  upcoming_release: () => m.home_match_reason_upcoming_release(),
  recently_added: () => m.home_match_reason_recently_added(),
  highly_rated: () => m.home_match_reason_highly_rated(),
  from_active_series: () => m.home_match_reason_from_active_series(),
  finishing_soon: () => m.home_match_reason_finishing_soon(),
};

export function ModalMatchReason({ reason }: Props) {
  if (!reason) return null;
  const text = COPY[reason.key](reason.params ?? {});
  return (
    <div className="px-6 sm:px-10">
      <div className="rounded-lg bg-secondary/70 px-3 py-2.5 text-xs text-muted-foreground">
        <span className="me-1 font-medium text-primary">
          {m.home_detail_match_reason_kicker()} →
        </span>
        {text}
      </div>
    </div>
  );
}
