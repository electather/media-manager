import type {
  DestinationDescriptor,
  RequestRecord,
  RequestStatus,
  RequestableItem,
  ServiceDescriptor,
} from "./types";

// Stub: returns "unavailable" by default. Real impl will resolve from
// item.status + active request rows + plugin availability.
export function effectiveItemRequestStatus(
  item: RequestableItem,
  requests: Record<string, RequestRecord>,
): RequestStatus {
  const existing = requests[item.id];
  if (existing) return existing.status;
  return "unavailable";
}

export function describeDestination(
  serviceId: string,
  profileId: string,
  services: ServiceDescriptor[],
): DestinationDescriptor {
  const service = services.find((s) => s.id === serviceId);
  const profile = service?.profiles.find((p) => p.id === profileId);
  return {
    serviceId,
    profileId,
    serviceLabel: service?.label ?? serviceId,
    profileLabel: profile?.label ?? profileId,
  };
}
