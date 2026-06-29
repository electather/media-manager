import type { ZodTypeAny } from "zod";
import { passwordIssueReason } from "@nama/shared/auth";
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

export function validateNewPassword(value: string): string | undefined {
  if (!value) return m.auth_password_required();
  const reason = passwordIssueReason(value);
  return reason ? m.auth_password_error({ reason }) : undefined;
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
