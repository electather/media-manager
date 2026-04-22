export const CONNECTION_STATUSES = ["connected", "expired", "error", "disconnected"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
