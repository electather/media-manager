import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { roles } from "./roles";

/**
 * Invite codes for the link-invite flow. An admin mints a code; a stranger
 * opens the link, registers, and is granted `roleId`. Multi-use codes are
 * supported via `maxUses`/`uses`; `revokedAt` is a soft-delete.
 *
 * `email` and `kind` are reserved for the future email-invite path
 * (see design §9). Only `kind = 'link'` is active.
 */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    /** Bearer token used as the URL code; stored plaintext (see design §2). */
    code: text("code").notNull().unique(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    /** The admin who created the invite; null when that admin has been deleted. */
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** 0 means unlimited uses. */
    maxUses: integer("max_uses").notNull().default(1),
    /** Atomically incremented on each successful accept. */
    uses: integer("uses").notNull().default(0),
    /** Non-null timestamp means the invite is revoked; the row is kept for
     *  audit purposes and excluded from list responses. */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /** Reserved for future email-invite path (§9). */
    email: text("email"),
    /** Reserved; only 'link' is active. */
    kind: text("kind").notNull().default("link"),
  },
  (table) => [
    // No explicit index on `code`: the `.unique()` constraint above already
    // creates `invites_code_unique`, which SQLite uses for every seek on `code`.
    index("invites_invited_by_idx").on(table.invitedBy),
    // Supports filtering active (non-revoked) invites as invite volume grows.
    index("invites_revoked_at_idx").on(table.revokedAt),
  ],
);
