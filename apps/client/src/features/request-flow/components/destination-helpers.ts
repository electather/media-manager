import * as m from "@/paraglide/messages";
import type { RequestDestination } from "../lib/types";

export function destinationTooltipText(destination: RequestDestination): string {
  if (destination.profileLabel) {
    return m.request_destination_via_service_profile({
      service: destination.serviceLabel,
      profile: destination.profileLabel,
    });
  }
  return m.request_destination_via_service({ service: destination.serviceLabel });
}
