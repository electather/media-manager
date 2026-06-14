import { z } from "zod";

/**
 * Single source of truth for new-password policy (client + server). Min 12 /
 * max 256 follows NIST SP 800-63B — favour length, accept passphrases, and cap
 * input so an over-long value cannot inflate hashing cost; every set/change
 * flow reuses this schema. Verifying an EXISTING credential is intentionally
 * not gated here (legacy accounts may be shorter — see
 * `deleteAccountSchema.currentPassword`). A known-breach (HIBP) screen is a
 * deferred service-layer follow-up.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
