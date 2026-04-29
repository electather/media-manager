// Seerr's raw `MediaStatus` enum (upstream): 1=UNKNOWN, 2=PENDING, 3=PROCESSING,
// 4=PARTIALLY_AVAILABLE, 5=AVAILABLE. We translate to our domain enum below;
// some collapse (4 → "processing") and some narrow (1 → "unavailable" because
// our API treats absence and unknown identically downstream).
export function mapMediaStatus(
  status: number,
): "available" | "requested" | "processing" | "unavailable" | "unknown" {
  switch (status) {
    case 5:
      return "available";
    case 4:
    case 3:
      return "processing";
    case 2:
      return "requested";
    case 1:
      return "unavailable";
    default:
      return "unknown";
  }
}

// Seerr's raw `MediaRequestStatus` enum (upstream): 1=PENDING, 2=APPROVED,
// 3=DECLINED, 4=AVAILABLE. Our domain enum renames 3 → "failed" so the
// callers can treat it uniformly with other terminal-failure states.
export function mapRequestStatus(
  status: number,
): "pending" | "approved" | "processing" | "available" | "failed" {
  switch (status) {
    case 1:
      return "pending";
    case 2:
      return "approved";
    case 3:
      return "failed";
    case 4:
      return "available";
    default:
      return "pending";
  }
}
