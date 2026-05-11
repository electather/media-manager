/**
 * Row returned by `GET /api/me/apps`. Represents an OAuth client a user has
 * granted access to (an "authorized application" in the settings UI).
 *
 * Date fields are epoch millis to match the shared/RPC convention used by
 * other shared types in this package (see `connections/types.ts`).
 */
/**
 * Server-derived activity status for an authorized OAuth client.
 *
 * - `active`  — token issued within the last 5 minutes.
 * - `new`     — consent created within the last 24h with no tokens issued yet.
 * - `idle`    — anything else (default).
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

/**
 * Subset of server configuration safe to expose to unauthenticated clients.
 *
 * Returned by `GET /api/public-config`; the settings UI reads it to decide
 * whether email-dependent flows (password reset, email change verification)
 * should be shown.
 */
export interface PublicConfig {
  emailEnabled: boolean;
  /**
   * Public-facing MCP endpoint URL (single mount; OAuth handles authn).
   * Built from `env.APP_EXTERNAL_URL` plus `/mcp`, falling back to the
   * request origin when the env var is missing in development.
   */
  mcpEndpointUrl: string;
  /** Coarse OAuth scopes published by the MCP server. */
  mcpScopes: readonly string[];
}
