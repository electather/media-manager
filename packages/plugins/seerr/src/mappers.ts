// Seerr media status: 1=unknown, 2=pending, 3=processing, 4=partial, 5=available.
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

// Seerr request status: 1=pending, 2=approved, 3=declined, 4=available.
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
