import * as m from "@/paraglide/messages";

type Props = {
  reason: string | undefined;
};

/**
 * "Why this →" callout under the seasons list. Uses the primary accent on a
 * muted card surface so it reads as an ambient recommendation tag rather
 * than a primary action. Wrapped in the standard gutter so the card edges
 * align with sibling sections.
 */
export function ModalMatchReason({ reason }: Props) {
  if (!reason) return null;
  return (
    <div className="px-6 sm:px-10">
      <div className="rounded-lg bg-secondary/70 px-3 py-2.5 text-xs text-muted-foreground">
        <span className="me-1 font-medium text-primary">
          {m.home_detail_match_reason_kicker()} →
        </span>
        {reason}
      </div>
    </div>
  );
}
