import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { roles } from "./roles";

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    /** Bearer token and URL token for the invite link. Stored plaintext — see design doc §1, §2. */
    code: text("code").notNull().unique(),
    /** Role granted on accept. */
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    /** Admin who created the invite. Null when the creating admin has been deleted. */
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Maximum number of uses. 0 means unlimited. */
    maxUses: integer("max_uses").notNull().default(1),
    /** Atomic use counter, incremented on accept. */
    uses: integer("uses").notNull().default(0),
    /** Soft revoke timestamp. Non-null means revoked. */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /** Reserved for future email invites. */
    email: text("email"),
    /** Invite kind. Only 'link' is active now; 'email' is reserved. */
    kind: text("kind", { enum: ["link", "email"] })
      .notNull()
      .default("link"),
  },
  (table) => [index("invites_code_idx").on(table.code), index("invites_role_idx").on(table.roleId)],
);
