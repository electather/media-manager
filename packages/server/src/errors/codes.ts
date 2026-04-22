/** Stable, namespaced identifiers used for translation lookup and error grouping.
 *  Adding an entry here forces callers to translate and prevents drift. */
export const HOST_ERROR_CODES = [
  "connection.test_failed",
  "connection.not_found",
  "connection.verify_failed",
  "connection.plugin_missing",
  "plugin.timeout",
  "plugin.output_invalid",
  "plugin.input_invalid",
  "plugin.disabled",
  "plugin.not_found",
  "plugin.upstream_error",
  "plugin.missing_method",
  "plugin.missing_refresh",
  "plugin.missing_auth_fn",
  "plugin.builtin_uninstall",
  "plugin.call_failed",
  "plugin.token_expired",
  "plugin.bad_credentials",
  "plugin.rate_limited",
  "plugin.item_not_found",
  "plugin.pool_exhausted",
  "plugin.capability_unavailable",
  "plugin.shared_credential_not_found",
  "plugin.shared_credential_conflict",
  "plugin.not_poolable",
  "plugin.scope_invalid",
  "media.no_connection",
  "media.primary_unavailable",
  "oauth.state_expired",
  "oauth.polling_timeout",
  "oauth.init_failed",
  "oauth.pending_not_found",
  "oauth.unexpected_status",
  "cron.job_failed",
  "http.internal_error",
  "http.not_found",
  "http.forbidden",
  "http.unauthorized",
  "http.invalid_input",
  "http.method_not_allowed",
  "mcp.ambiguous_target",
  "mcp.target_not_found",
  "mcp.forbidden",
  "mcp.invalid_id",
  "mcp.not_connected",
  "mcp.rate_limited",
  "mcp.tool_not_found",
  "mcp.output_invalid",
  "mcp.bad_input",
  "job.not_found",
  "job.already_running",
  "job.disabled",
  "job.bad_input",
  "job.wrong_kind",
  "job.forbidden",
] as const;

export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

/** Wire-format shape returned by any error-producing oRPC/HTTP handler.
 *  `devMessage` is English free-form for logs; `code` + `params` drive user-facing translation. */
export interface UserFacingError {
  code: string;
  params?: Record<string, string | number>;
  devMessage: string;
  cause?: unknown;
  requestId?: string;
  /** Code-specific structured payload. e.g. `candidates` for `mcp.ambiguous_target`. */
  details?: Record<string, unknown>;
}

/** Builds a `plugin.<pluginId>.<code>` namespaced identifier for plugin-emitted errors. */
export function pluginCode(pluginId: string, code: string): string {
  return `plugin.${pluginId}.${code}`;
}
