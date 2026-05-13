/**
 * Better Auth session shape, narrowed to the fields the security tab reads.
 * The full type lives in `better-auth/types`; we keep this local one to
 * decouple the UI from upstream churn.
 */
export interface AuthSession {
  id: string;
  token: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
}
