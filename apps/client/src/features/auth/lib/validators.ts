import type { ZodTypeAny } from "zod";
import { type PasswordIssueReason, passwordIssueReason } from "@nama/shared/auth";
import { createUserSchema } from "@nama/shared/users";
import { m } from "@/paraglide/messages";

function validateSchemaField(
  value: string,
  schema: ZodTypeAny,
  requiredMessage: string,
  invalidMessage: string,
): string | undefined {
  if (!value) return requiredMessage;
  const result = schema.safeParse(value);
  if (!result.success) return invalidMessage;
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  return validateSchemaField(
    value,
    createUserSchema.shape.email,
    m.auth_email_required(),
    m.auth_email_invalid(),
  );
}

export function validateLoginPassword(value: string): string | undefined {
  if (!value) return m.auth_password_required();
  return undefined;
}

// Maps the shared reason to its localized message, so reason logic stays in
// `passwordIssueReason` (single source) and this only owns the copy.
const PASSWORD_MESSAGE: Record<PasswordIssueReason, () => string> = {
  too_long: m.auth_password_too_long,
  too_short: m.auth_password_too_short,
  missing_alphanumeric: m.auth_password_missing_alphanumeric,
};

export function validateNewPassword(value: string): string | undefined {
  if (!value) return m.auth_password_required();
  const reason = passwordIssueReason(value);
  return reason ? PASSWORD_MESSAGE[reason]() : undefined;
}

export function validateConfirmPassword(value: string, password: string): string | undefined {
  if (!value) return m.auth_confirm_password_required();
  if (value !== password) return m.auth_passwords_do_not_match();
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (!value.trim()) return m.auth_name_required();
  return undefined;
}
