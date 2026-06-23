import { z } from "zod";

/**
 * Single source of truth for new-password policy (client + server). Min 12 / max 256
 * follows NIST SP 800-63B — favour length, cap to prevent hashing-cost inflation; every
 * set/change flow reuses this. Verifying an EXISTING credential is not gated here (legacy
 * accounts may be shorter — see `deleteAccountSchema.currentPassword`). HIBP screen deferred.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
