import { z } from "zod";
import { passwordSchema } from "../auth/password";

/** Schema for creating a new invite link. The handler validates expiresAt > Date.now(). */
export const createInviteSchema = z.object({
  roleId: z.string().min(1),
  /** Absolute expiry as a millisecond timestamp. Must be in the future (enforced in handler). */
  expiresAt: z.number().int().positive(),
  /** Maximum number of accepts. 0 means unlimited. */
  maxUses: z.number().int().min(0),
});

/** Schema for extending an existing invite's expiry. The handler validates expiresAt > Date.now(). */
export const extendInviteSchema = z.object({
  /** New absolute expiry as a millisecond timestamp. Must be in the future (enforced in handler). */
  expiresAt: z.number().int().positive(),
});

/** Schema for accepting an invite link as a new user. */
export const acceptInviteSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: passwordSchema,
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type ExtendInviteInput = z.infer<typeof extendInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** DTO returned to admins. The `url` is constructed server-side (includes APP_EXTERNAL_URL). */
export interface AdminInviteDTO {
  id: string;
  code: string;
  /** Full invite URL constructed server-side. Client copies this directly. */
  url: string;
  roleId: string;
  /** User ID of the admin who created the invite. Null when that admin has been deleted. */
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  /** Server-computed: true when expiresAt < now, uses >= maxUses (and maxUses != 0), or revokedAt set. */
  expired: boolean;
}

/** Minimal DTO returned to unauthenticated accepters. Does not leak invite internals. */
export interface InvitePreviewDTO {
  roleName: string;
  expiresAt: number;
}
