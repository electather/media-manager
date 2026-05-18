import { consola } from "consola";
import type { OutboundEmail } from "./email";

interface Logger {
  warn: (message: string, ...args: unknown[]) => void;
}

// Mirrors the relevant slice of Better Auth's hook ctx without depending on
// internal types. We only read the session user's id, which is stable across
// versions and present whenever the update is initiated by an authenticated
// caller (the only path the change-email flow takes today).
type UpdateHookCtxLike =
  | {
      context?: {
        session?: {
          user?: {
            id?: string;
          };
        };
      };
    }
  | null
  | undefined;

export interface EmailChangeHookDeps {
  // Reads the current email for the given user id, returning null if no row.
  // Errors should propagate; the before hook traps them so DB failure cannot
  // break the underlying user update.
  readUserEmail: (id: string) => Promise<string | null>;
  sendEmail: (message: OutboundEmail) => Promise<void>;
  logger?: Logger;
}

// Loose param types so the returned hooks structurally match Better Auth's
// `databaseHooks.user.update` shape (which passes Partial<User> / User plus
// `GenericEndpointContext | null`) without importing internal BA types.
export interface EmailChangeHooks {
  before: (data: Record<string, unknown>, ctx: unknown) => Promise<void>;
  after: (
    updatedUser: { id: string; email: string } & Record<string, unknown>,
    ctx?: unknown,
  ) => Promise<void>;
}

/**
 * Better Auth 1.6 has no built-in post-switch notification for an email
 * change. We synthesise one with a `before`/`after` pair on the user-update
 * database hook:
 *
 * - `before` reads the user's *current* email straight from the DB and parks
 *   it in a per-user Map. This must run before Better Auth's write so the
 *   captured value is guaranteed to be the OLD email.
 * - `after` looks up the captured value, clears it, and emails the OLD
 *   address when the row's new email differs.
 *
 * The target user id is read from `ctx.context.session.user.id`. Better
 * Auth's `update.before` hook signature is `(data, ctx)` where `data` is the
 * partial update payload (no id) and the row is selected separately via the
 * adapter's `where` clause, so the session is the only in-hook source of the
 * target id for both `/update-user` and `/change-email`.
 *
 * Tradeoffs:
 * - Memory leak: if the process crashes between the DB write and the `after`
 *   hook firing, the Map entry survives until process exit. Small strings,
 *   low volume — acceptable for a self-hosted personal app.
 * - Concurrency: two simultaneous updates for the same user id can clobber
 *   the Map slot. SQLite serialises writes so this is unlikely in practice,
 *   and at worst it skips a notification rather than misdirecting one.
 */
function extractTargetUserId(ctx: unknown): string | null {
  const id = (ctx as UpdateHookCtxLike)?.context?.session?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function createEmailChangeHooks(deps: EmailChangeHookDeps): EmailChangeHooks {
  const pending = new Map<string, string>();
  const log = deps.logger ?? consola;

  const capturePreviousEmail = async (targetId: string): Promise<void> => {
    try {
      const email = await deps.readUserEmail(targetId);
      if (email !== null) pending.set(targetId, email);
    } catch (err) {
      log.warn("[auth] failed to capture pre-update email for change notification", err);
    }
  };

  const dispatchNotification = async (previousEmail: string, newEmail: string): Promise<void> => {
    try {
      await deps.sendEmail({
        to: previousEmail,
        subject: "Your email address was changed",
        text: `Your account email was changed to ${newEmail}. If you did not approve this, contact support immediately.`,
      });
    } catch (err) {
      log.warn("[auth] failed to send email-change notification", err);
    }
  };

  return {
    before: async (_data, ctx) => {
      const targetId = extractTargetUserId(ctx);
      if (targetId === null) return;
      await capturePreviousEmail(targetId);
    },
    after: async (updatedUser) => {
      const previousEmail = pending.get(updatedUser.id);
      pending.delete(updatedUser.id);
      if (!previousEmail || previousEmail === updatedUser.email) return;
      await dispatchNotification(previousEmail, updatedUser.email);
    },
  };
}
