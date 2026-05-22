import type { ErrorSeverity } from "./enums";

/** Severity classification attached to each stable error code.
 *
 * - `error`   — genuine bug or infrastructure failure. Surfaced on the
 *               admin viewer's default filter.
 * - `warning` — unexpected but recovered from (e.g. plugin returned malformed
 *               output, fell back to a secondary).
 * - `info`    — expected user-input failure (bad URL, wrong password, stale
 *               404). Stored alongside the other severities so admins can
 *               filter them in when debugging, but excluded from the default
 *               error view per the error design doc §Severity model.
 *
 * The registry's classification is the default severity applied at the
 * `captureError` boundary. Callers can still pass an explicit `severity` to
 * bump a normally-error code down to `warning` for recovered paths.
 */
export interface ErrorCodeSpec {
  severity: ErrorSeverity;
}

/** Stable, namespaced identifiers used for translation lookup, error grouping,
 *  and default-severity classification. Adding an entry here forces callers
 *  to translate and prevents drift. The per-code object leaves room to grow
 *  into extra metadata (translation hints, default HTTP status, category)
 *  without a breaking refactor of every consumer. */
export const HOST_ERROR_CODES = {
  // Connection lifecycle. Test/verify failures are typically driven by user
  // input (bad URL, expired password); 404s are always user-facing.
  "connection.test_failed": { severity: "info" },
  "connection.not_found": { severity: "info" },
  "connection.verify_failed": { severity: "info" },
  "connection.plugin_missing": { severity: "error" },

  // Plugin runtime.
  "plugin.timeout": { severity: "error" },
  "plugin.output_invalid": { severity: "warning" },
  "plugin.input_invalid": { severity: "info" },
  "plugin.disabled": { severity: "info" },
  "plugin.not_found": { severity: "info" },
  "plugin.upstream_error": { severity: "error" },
  "plugin.missing_method": { severity: "error" },
  "plugin.missing_refresh": { severity: "error" },
  "plugin.missing_auth_fn": { severity: "error" },
  "plugin.builtin_uninstall": { severity: "info" },
  "plugin.call_failed": { severity: "error" },
  "plugin.token_expired": { severity: "info" },
  "plugin.bad_credentials": { severity: "info" },
  "plugin.rate_limited": { severity: "warning" },
  "plugin.item_not_found": { severity: "info" },
  "plugin.pool_exhausted": { severity: "warning" },
  "plugin.capability_unavailable": { severity: "info" },
  "plugin.shared_credential_not_found": { severity: "info" },
  "plugin.shared_credential_conflict": { severity: "info" },
  "plugin.not_poolable": { severity: "info" },
  "plugin.scope_invalid": { severity: "info" },
  "plugin.host_blocked_by_admin": { severity: "warning" },
  // Form-validation errors carrying a `params.field` so the client can inline-route them.
  "plugin.credentials_empty": { severity: "info" },
  "plugin.duplicate_label": { severity: "info" },
  "plugin.invalid_base_url": { severity: "info" },

  // Media dispatcher.
  "media.no_connection": { severity: "info" },
  "media.primary_unavailable": { severity: "warning" },
  // 5xx HTTP path is stamped "error" by errorHandler regardless (§Cap.E);
  // this entry exists for non-HTTP capture sites.
  "media.providers_failed": { severity: "error" },

  // Artwork capability and RPC.
  "artwork.bad_input": { severity: "info" },
  "artwork.unsupported_id_combo": { severity: "info" },
  "artwork.internal": { severity: "error" },

  // OAuth flow.
  "oauth.state_expired": { severity: "info" },
  "oauth.polling_timeout": { severity: "info" },
  "oauth.init_failed": { severity: "error" },
  "oauth.pending_not_found": { severity: "info" },
  "oauth.unexpected_status": { severity: "error" },

  // Cron.
  "cron.job_failed": { severity: "error" },
  // Manifest persisted in plugins.manifest failed JSON.parse or schema validation
  // at startup registration; the row is skipped so other plugins still register.
  "cron.manifest_invalid": { severity: "error" },

  // HTTP envelope. 4xx-mapped codes land here for reference but the HTTP
  // middleware's `isExpectedUserError` already skips their capture; the info
  // classification is defence in depth for any non-middleware callsite.
  "http.internal_error": { severity: "error" },
  "http.not_found": { severity: "info" },
  "http.forbidden": { severity: "info" },
  "http.unauthorized": { severity: "info" },
  "http.invalid_input": { severity: "info" },
  "http.method_not_allowed": { severity: "info" },

  // MCP dispatcher.
  "mcp.ambiguous_target": { severity: "info" },
  "mcp.target_not_found": { severity: "info" },
  "mcp.forbidden": { severity: "info" },
  "mcp.invalid_id": { severity: "info" },
  "mcp.not_connected": { severity: "info" },
  "mcp.rate_limited": { severity: "warning" },
  "mcp.tool_not_found": { severity: "info" },
  "mcp.output_invalid": { severity: "warning" },
  "mcp.bad_input": { severity: "info" },

  // Jobs.
  "job.not_found": { severity: "info" },
  "job.already_running": { severity: "info" },
  "job.disabled": { severity: "info" },
  "job.bad_input": { severity: "info" },
  "job.wrong_kind": { severity: "info" },
  "job.forbidden": { severity: "info" },

  // Home feed.
  "home.bad_input": { severity: "info" },
  "home.row_unavailable": { severity: "info" },
  "home.internal": { severity: "error" },
} as const satisfies Record<string, ErrorCodeSpec>;

export type HostErrorCode = keyof typeof HOST_ERROR_CODES;

/** Looks up the registered severity for a code. Unknown codes (e.g.
 *  plugin-namespaced `plugin.<id>.<code>` identifiers that were not declared
 *  as host codes) default to `error` — better to over-capture than miss. */
export function severityFor(code: string): ErrorSeverity {
  const spec = (HOST_ERROR_CODES as Record<string, ErrorCodeSpec | undefined>)[code];
  return spec?.severity ?? "error";
}

/** Wire-format shape returned by any error-producing RPC/HTTP handler.
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
