export const ERROR_SEVERITIES = ["error", "warning", "info"] as const;
export const ERROR_SOURCES = ["frontend", "backend", "plugin", "cron"] as const;

export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];
export type ErrorSource = (typeof ERROR_SOURCES)[number];
