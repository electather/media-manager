/** OAuth client a user has authorized (from `GET /api/me/apps`). Epoch millis dates match shared/RPC convention (see `connections/types.ts`). */
/**
 * Server-derived activity status: `active` (token ≤5m), `new` (consent ≤24h, unused), `idle` (else).
 */
export type AuthorizedAppStatus = "active" | "idle" | "new";

export interface AuthorizedApp {
  clientId: string;
  /** `oauthClient.name`, falling back to `clientId` when missing. */
  name: string;
  /** Scopes granted by `oauthConsent.scopes`. */
  scopes: string[];
  /** `oauthConsent.createdAt` for `(user, client)`. */
  connectedAt: number;
  /** `MAX(oauthAccessToken.createdAt)` for the user/client pair, or `null` if never used. */
  lastUsedAt: number | null;
  /** `oauthClient.userId === currentUser.id`. */
  ownedByUser: boolean;
  /** Server-derived activity bucket; rendered as a pill in the UI. */
  status: AuthorizedAppStatus;
}

/** Compact shape of a role used by user-facing surfaces (e.g. settings profile). */
export interface RoleSummary {
  name: string;
  description: string | null;
}

/** Public server config from `GET /api/config/public`; settings UI uses it to decide whether to show email-dependent flows. */
export interface PublicConfig {
  emailEnabled: boolean;
  /** True on a fresh install with zero users; the client funnels to /bootstrap. */
  needsBootstrap: boolean;
  /**
   * Public-facing MCP endpoint URL (single mount; OAuth handles authn).
   * Built from `env.APP_EXTERNAL_URL` plus `/mcp`, falling back to the
   * request origin when the env var is missing in development.
   */
  mcpEndpointUrl: string;
  /** Coarse OAuth scopes published by the MCP server. */
  mcpScopes: readonly string[];
}
