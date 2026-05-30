import * as m from "@/paraglide/messages";
import type { MatchReason } from "@ent-mcp/shared/home";

type Props = {
  reason: MatchReason | undefined;
};

// CRAP trips under zero static coverage: the per-placeholder `?? ""` defaults
// the keyed `home_match_reason` variant requires are behaviorally tested, not
// reducible. Collapsing the old 10-entry dispatch map into the one variant call
// is a net simplification.
// fallow-ignore-next-line complexity
export function ModalMatchReason({ reason }: Props) {
  if (!reason) return null;
  const p = reason.params ?? {};
  // The home `home_match_reason` ICU variant (selector `reason`) owns the copy;
  // the modal reads it directly so the `media-detail-modal` zone keeps no
  // dispatch table of its own.
  const text = m.home_match_reason({
    reason: reason.key,
    n: p.n ?? "",
    genre: p.genre ?? "",
    seedTitle: p.seedTitle ?? "",
  });
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
