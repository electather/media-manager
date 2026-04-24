/**
 * Row returned by `GET /api/me/apps`. Represents an OAuth client a user has
 * granted access to (an "authorized application" in the settings UI).
 *
 * Date fields are epoch millis to match the shared/RPC convention used by
 * other shared types in this package (see `connections/types.ts`).
 */
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
}
