import { z } from "zod";
import { passwordSchema } from "../auth";

/** Body for `POST /admin/users`. */
export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: passwordSchema,
  roleId: z.string().optional(),
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

/** Body for `PATCH /admin/users/:id`. */
export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.email().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

/** Body for `PUT /admin/users/:id/role`. */
export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
});
export type AssignRoleBody = z.infer<typeof assignRoleSchema>;

/**
 * Body for `POST /api/me/delete`. Both fields are required confirmation gates;
 * the server re-verifies `confirmEmail` matches the session user and that
 * `currentPassword` is valid before performing the destructive action.
 */
export const deleteAccountSchema = z.object({
  confirmEmail: z.email(),
  currentPassword: z.string().min(8),
});
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;
