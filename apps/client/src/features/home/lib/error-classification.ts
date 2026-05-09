import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";
import type { MessageKey } from "./types";
import { HomeApiError } from "./types";

/**
 * UI-facing taxonomy of home boundary failures. Each variant maps to a
 * distinct fallback (copy + recovery affordance) so re-login, offline,
 * upstream/server, and unknown failures don't collapse into one button.
 */
export type HomeErrorVariant = "auth" | "offline" | "network" | "server" | "unknown";

export interface HomeErrorView {
  variant: HomeErrorVariant;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** Stable error code (server-shipped or synthesized) used for telemetry. */
  code: string;
  /** Server status when known, else `null`. */
  status: number | null;
  /** Server-shipped human-readable string ( `devMessage` or `message`). */
  devMessage: string | null;
  /** When `true`, the fallback should offer a "re-login" affordance. */
  needsRelogin: boolean;
}

const AUTH_CODES = new Set<string>([
  "http.unauthorized",
  "http.forbidden",
  "plugin.token_expired",
  "plugin.bad_credentials",
]);

const OFFLINE_NAMES = new Set<string>(["TypeError", "NetworkError"]);

function isOffline(error: Error): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  // `fetch()` rejects with a `TypeError` when the network is unreachable.
  return !(error instanceof HomeApiError) && OFFLINE_NAMES.has(error.name);
}

function readDevMessage(body: ApiErrorBody | null): string | null {
  if (!body) return null;
  if (typeof body.message === "string" && body.message.length > 0) return body.message;
  const dev = body.devMessage;
  return typeof dev === "string" && dev.length > 0 ? dev : null;
}

const TITLE_BY_VARIANT: Record<HomeErrorVariant, MessageKey> = {
  auth: "home_error_auth_title",
  offline: "home_error_offline_title",
  network: "home_error_network_title",
  server: "home_error_server_title",
  unknown: "home_error_unknown_title",
};

const BODY_BY_VARIANT: Record<HomeErrorVariant, MessageKey> = {
  auth: "home_error_auth_body",
  offline: "home_error_offline_body",
  network: "home_error_network_body",
  server: "home_error_server_body",
  unknown: "home_error_unknown_body",
};

/**
 * Classifies a thrown error into a presentation-ready view. Reads the
 * server-shipped `code` from `HomeApiError.body` when available and falls back
 * to status-based inference (401/403 → auth, 5xx → server, network → offline).
 */
export function classifyHomeError(error: Error): HomeErrorView {
  const status = error instanceof HomeApiError ? error.status : null;
  const code =
    error instanceof HomeApiError && typeof error.code === "string" ? error.code : "client.unknown";
  const devMessage =
    error instanceof HomeApiError ? readDevMessage(error.body) : (error.message ?? null);
  const variant = pickVariant(error, status, code);
  return {
    variant,
    titleKey: TITLE_BY_VARIANT[variant],
    bodyKey: BODY_BY_VARIANT[variant],
    code,
    status,
    devMessage,
    needsRelogin: variant === "auth",
  };
}

function pickVariant(error: Error, status: number | null, code: string): HomeErrorVariant {
  if (isOffline(error)) return "offline";
  if (status === 401 || status === 403 || AUTH_CODES.has(code)) return "auth";
  if (code === "plugin.timeout" || code === "plugin.rate_limited") return "network";
  if (status !== null && status >= 500) return "server";
  if (code === "home.internal" || code === "http.internal_error") return "server";
  if (code.startsWith("plugin.upstream") || code.startsWith("plugin.pool_")) return "server";
  return "unknown";
}
