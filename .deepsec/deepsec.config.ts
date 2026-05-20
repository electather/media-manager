import { defineConfig, type DeepsecPlugin } from "deepsec/config";
import { isSystemAdminSingleCondition } from "./matchers/is-system-admin-single-condition.js";
import { connectionStartAuthNoStrip } from "./matchers/connection-start-auth-no-strip.js";
import { decryptJsonUnguarded } from "./matchers/decrypt-json-unguarded.js";
import { encryptionKeyHardcode } from "./matchers/encryption-key-hardcode.js";
import { pluginRuntimeRawFetch } from "./matchers/plugin-runtime-raw-fetch.js";
import { mcpToolNoRequiredScopes } from "./matchers/mcp-tool-no-required-scopes.js";
import { honoProcedureNoSession } from "./matchers/hono-procedure-no-session.js";
import { honoAdminNoPermission } from "./matchers/hono-admin-no-permission.js";
import { pluginSchemaUrlNoAllowedHost } from "./matchers/plugin-schema-url-no-allowed-host.js";
import { mcpHandlerNoOAuth } from "./matchers/mcp-handler-no-oauth.js";

const mediaManagerPlugin: DeepsecPlugin = {
  name: "media-manager-internal",
  matchers: [
    isSystemAdminSingleCondition,
    connectionStartAuthNoStrip,
    decryptJsonUnguarded,
    encryptionKeyHardcode,
    pluginRuntimeRawFetch,
    mcpToolNoRequiredScopes,
    honoProcedureNoSession,
    honoAdminNoPermission,
    pluginSchemaUrlNoAllowedHost,
    mcpHandlerNoOAuth,
  ],
};

export default defineConfig({
  projects: [
    {
      id: "media-manager",
      root: "..",
      promptAppend:
        "Pay extra attention to: (a) any `isSystemAdmin` flag set from a single condition; (b) `runAuth(..., 'startAuth', ...)` / `writeConnection` callsites whose `userConfig` did not flow through `stripRequestFields`; (c) `decryptJson` results used without a null guard; (d) any hardcoded or fallback value supplied for `ENCRYPTION_KEY`; (e) bare `fetch(` calls inside `apps/server/src/plugin-runtime/` that bypass `buildFetch`; (f) MCP tool registrations whose `requiredScopes` is `[]`; (g) plugin `userConfigSchema` URL fields missing `\"x-allowed-host\": true`. Treat OAuth discovery endpoints, `/api/config/public`, and `crypto/vault.ts`'s internal `btoa(String.fromCharCode(...))` as known false-positives.",
      priorityPaths: [
        "apps/server/src/auth/",
        "apps/server/src/mcp/",
        "apps/server/src/connections/",
        "apps/server/src/plugin-runtime/",
        "apps/server/src/crypto/",
        "apps/server/src/api/procedures/",
        "packages/plugins/",
        "packages/plugin-sdk/",
      ],
    },
    // <deepsec:projects-insert-above>
  ],
  plugins: [mediaManagerPlugin],
});
