import { Star } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
};

const SECTION_LABEL_CLASS =
  "font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground";
// `min-w-22` resolves to 5.5rem / 88px under Tailwind v4 defaults — matches
// the prototype's `minWidth: 88` on each score block.
const SCORE_CARD_CLASS = "flex min-w-22 flex-col gap-1 rounded-lg bg-secondary/70 px-4 py-3";

export function ModalScores({ item }: Props) {
  const { rating, audienceScore, criticScore, votes } = item;
  if (rating === undefined && audienceScore === undefined && criticScore === undefined) return null;

  return (
    <div className="flex flex-wrap gap-2 px-6 sm:px-10">
      {rating !== undefined ? <RatingCard rating={rating} votes={votes} /> : null}
      {audienceScore !== undefined ? (
        <ScoreCard label={m.home_detail_score_audience()} value={`${audienceScore}%`} />
      ) : null}
      {criticScore !== undefined ? (
        <ScoreCard label={m.home_detail_score_critics()} value={`${criticScore}%`} />
      ) : null}
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={SCORE_CARD_CLASS}>
      <div className={SECTION_LABEL_CLASS}>{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function RatingCard({ rating, votes }: { rating: number; votes?: number }) {
  return (
    <div className={SCORE_CARD_CLASS}>
      <div className={SECTION_LABEL_CLASS}>{m.home_detail_score_rating()}</div>
      <div className="flex items-baseline gap-1.5">
        <Star aria-hidden="true" className="size-4 fill-primary text-primary" />
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {rating.toFixed(1)}
        </span>
        {votes !== undefined ? <VotesText votes={votes} /> : null}
      </div>
    </div>
  );
}

const VOTES_FORMATTER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function VotesText({ votes }: { votes: number }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {m.home_detail_score_votes({ n: VOTES_FORMATTER.format(votes) })}
    </span>
  );
}
