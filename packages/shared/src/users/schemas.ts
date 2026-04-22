import { z } from "zod";

/** Body for `POST /admin/users`. */
export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  roleId: z.string().optional(),
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

/** Body for `PATCH /admin/users/:id`. */
export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.email().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

/** Body for `PUT /admin/users/:id/role`. */
export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
});
export type AssignRoleBody = z.infer<typeof assignRoleSchema>;
