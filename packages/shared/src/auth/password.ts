import { z } from "zod";

/**
 * New-password policy shared by client + server (NIST SP 800-63B): min 12, max 256 to cap
 * hashing cost. Existing-credential checks skip this — legacy accounts may be shorter (see
 * `deleteAccountSchema.currentPassword`). HIBP screen deferred.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
