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
function hasLetterAndDigit(value: string): boolean {
  return /\p{L}/u.test(value) && /\p{N}/u.test(value);
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine(hasLetterAndDigit, {
    message: "Password must contain at least one letter and one digit.",
  });

const PASSWORD_ISSUE_REASONS = ["too_long", "too_short", "missing_alphanumeric"] as const;
export type PasswordIssueReason = (typeof PASSWORD_ISSUE_REASONS)[number];

/**
 * Translates a `passwordSchema` failure into the reason every client surface maps to a message.
 * Derived from the schema's own parse result — `passwordSchema` is the single source of the
 * rules, so a future rule can't make the UI disagree with the server. Null when the value passes.
 */
export function passwordIssueReason(value: string): PasswordIssueReason | null {
  const result = passwordSchema.safeParse(value);
  if (result.success) return null;
  const issues = result.error.issues;
  if (issues.some((issue) => issue.code === "too_big")) return "too_long";
  if (issues.some((issue) => issue.code === "too_small")) return "too_short";
  return "missing_alphanumeric";
}
