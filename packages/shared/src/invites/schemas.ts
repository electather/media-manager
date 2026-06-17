import { z } from "zod";
import { passwordSchema } from "../auth/password";

/**
 * Input schema for creating a link invite. `expiresAt > Date.now()` is
 * enforced in the route handler (not here) so a schema check doesn't race
 * on slow networks. `maxUses = 0` means unlimited.
 */
export const createInviteSchema = z.object({
  roleId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  maxUses: z.number().int().min(0),
});

/**
 * Input schema for extending a link invite. Supplies a new absolute expiry
 * timestamp; the handler validates it is in the future.
 */
export const extendInviteSchema = z.object({
  expiresAt: z.number().int().positive(),
});

/**
 * Input schema for the public accept endpoint. The accepter supplies their
 * own name, email, and password; the server creates the account and assigns
 * the invite's role.
 */
export const acceptInviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
});
