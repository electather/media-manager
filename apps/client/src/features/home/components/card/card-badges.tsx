import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import type { HomeMediaItem } from "../../lib/types";

interface CardBadgesProps {
  status: HomeMediaItem["availability"];
}

/** Displays an availability badge for a card based on server availability state. */
export function CardBadges({ status }: CardBadgesProps) {
  if (!status) return null;

  if (status.hasAnyServerCopy) {
    // Item is available on at least one media server.
    return (
      <Badge className="border-success/30 bg-success/20 text-success" variant="outline">
        {m.home_card_available()}
      </Badge>
    );
  }

  if (!status.requestEligible) {
    // Item has already been requested by the user.
    return (
      <Badge className="border-warning/30 bg-warning/20 text-warning" variant="outline">
        {m.home_card_requested()}
      </Badge>
    );
  }

  // Item is not available but can be requested.
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {m.home_card_unavailable()}
    </Badge>
  );
}
