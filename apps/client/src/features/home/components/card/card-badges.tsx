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
      <Badge className="border-green-500/30 bg-green-500/20 text-green-400" variant="outline">
        {m.home_card_available()}
      </Badge>
    );
  }

  if (!status.requestEligible) {
    // Item has already been requested by the user.
    return (
      <Badge className="border-orange-500/30 bg-orange-500/20 text-orange-400" variant="outline">
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
