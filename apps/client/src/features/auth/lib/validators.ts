import type { ZodTypeAny } from "zod";
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
  // Validate against the shared schema (single source of truth), then branch on
  // which bound failed so the message points the right direction.
  const result = createUserSchema.shape.password.safeParse(value);
  if (result.success) return undefined;
  // Length wins over composition: report a bound failure before the alphanumeric refine.
  const codes = result.error.issues.map((issue) => issue.code);
  if (codes.includes("too_big")) return m.auth_password_too_long();
  if (codes.includes("too_small")) return m.auth_password_too_short();
  return m.auth_password_missing_alphanumeric();
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
