import { z } from "zod";

/**
 * New-password policy shared by client + server: 8–256 chars, must contain ≥1 letter and ≥1
 * digit; any other characters allowed. Letter/digit are matched Unicode-aware (`\p{L}`/`\p{N}`)
 * so non-Latin scripts (e.g. Farsi letters + digits ۰–۹) satisfy the rule. Existing-credential
 * checks skip this — legacy accounts may differ. Max caps hashing cost.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/** True when the value has at least one Unicode letter and one Unicode digit. */
export function hasLetterAndDigit(value: string): boolean {
  return /\p{L}/u.test(value) && /\p{N}/u.test(value);
}

export const PASSWORD_ISSUE_REASONS = ["too_long", "too_short", "missing_alphanumeric"] as const;
export type PasswordIssueReason = (typeof PASSWORD_ISSUE_REASONS)[number];

/**
 * Single source of the new-password failure reason, shared by every client surface so the
 * displayed message can never drift from `passwordSchema`. Length wins over composition.
 * Returns null when the value satisfies the policy.
 */
export function passwordIssueReason(value: string): PasswordIssueReason | null {
  if (value.length > PASSWORD_MAX_LENGTH) return "too_long";
  if (value.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (!hasLetterAndDigit(value)) return "missing_alphanumeric";
  return null;
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine(hasLetterAndDigit, {
    message: "Password must contain at least one letter and one digit.",
  });
