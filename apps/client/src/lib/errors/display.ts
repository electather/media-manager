export interface UserFacingError {
  code: string;
  params?: Record<string, string | number>;
  devMessage: string;
  requestId?: string;
}

/** Lightweight interpolation that mirrors the i18next `{{key}}` placeholder syntax so
 *  translation files written for i18next drop in later without rewriting templates. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{{${key}}}`,
  );
}

/** English-first translation table. A proper i18n stack (i18next) can replace this
 *  with a runtime lookup without changing any caller. Translation keys match the
 *  namespaced error codes defined on the server side. */
const EN: Record<string, string> = {
  "connection.test_failed": "Could not connect to {{pluginName}}: {{reason}}",
  "connection.not_found": "Connection not found.",
  "connection.verify_failed": "Could not verify this connection.",
  "plugin.timeout": "The {{pluginName}} plugin took too long to respond.",
  "plugin.output_invalid": "The plugin returned an unexpected response.",
  "plugin.disabled": "The {{pluginName}} plugin is disabled.",
  "oauth.state_expired": "Authorization took too long and expired. Please try again.",
  "http.internal_error": "Something went wrong. Please try again.",
  "http.not_found": "Not found.",
  "http.forbidden": "You don't have permission to do that.",
  "http.unauthorized": "Please sign in again.",
};

/** Renders a UserFacingError for display. Falls back to `devMessage` when no
 *  translation exists for the code. */
export function displayError(err: UserFacingError): string {
  const template = EN[err.code];
  if (template) return interpolate(template, err.params);
  return err.devMessage;
}
