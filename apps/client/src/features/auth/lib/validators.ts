import type { ZodTypeAny } from "zod";
import { createUserSchema } from "@ent-mcp/shared/users";
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
  return validateSchemaField(
    value,
    createUserSchema.shape.password,
    m.auth_password_required(),
    m.auth_password_too_short(),
  );
}

export function validateConfirmPassword(value: string, password: string): string | undefined {
  if (!value) return m.auth_confirm_password_required();
  if (value !== password) return m.auth_passwords_do_not_match();
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (!value.trim()) return m.auth_name_required();
  return validateSchemaField(
    value,
    createUserSchema.shape.name,
    m.auth_name_required(),
    m.auth_name_invalid(),
  );
}
