import { z } from "zod";

/**
 * New-password policy shared by client + server: 8–256 chars, must contain ≥1 letter and ≥1
 * digit; any other characters allowed. Existing-credential checks skip this — legacy accounts
 * may differ (see `deleteAccountSchema.currentPassword`). Max caps hashing cost.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "Password must contain at least one letter and one digit.",
  });
