import { createUserSchema } from "@ent-mcp/shared/users";
import { m } from "@/paraglide/messages";

export function validateEmail(value: string): string | undefined {
  if (!value) return m.auth_email_required();
  const result = createUserSchema.shape.email.safeParse(value);
  if (!result.success) return m.auth_email_invalid();
  return undefined;
}

export function validateLoginPassword(value: string): string | undefined {
  if (!value) return m.auth_password_required();
  return undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) return m.auth_password_required();
  const result = createUserSchema.shape.password.safeParse(value);
  if (!result.success) return m.auth_password_too_short();
  return undefined;
}

export function validateConfirmPassword(value: string, password: string): string | undefined {
  if (!value) return m.auth_confirm_password_required();
  if (value !== password) return m.auth_passwords_do_not_match();
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (!value.trim()) return m.auth_name_required();
  const result = createUserSchema.shape.name.safeParse(value);
  if (!result.success) return m.auth_name_invalid();
  return undefined;
}
