import { registerScheduled } from "../../jobs/scheduled";
import { sweepStaleDynamicClients } from "../service";

// Dynamically-registered clients that no user has authorized within this window
// are treated as abandoned and removed. The window is generous enough that a
// real MCP client, which registers then prompts the user to authorize, is never
// caught — honest first-connect completes in minutes, not hours.
const STALE_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes dynamic OAuth clients (RFC 7591) never authorized by a user and older
 * than TTL. Bounds oauth client table growth (only other control: per-IP rate limit)
 * and shrinks the consent/authorize attack surface from abandoned registrations.
 */
export function registerStaleClientSweep(): void {
  registerScheduled({
    id: "host.auth.stale_client_sweep",
    name: "OAuth stale client sweep",
    description: "Delete dynamically-registered OAuth clients that were never authorized",
    schedule: "0 * * * *",
    handler: async (ctx) => {
      const cutoff = Date.now() - STALE_CLIENT_TTL_MS;
      const removed = await sweepStaleDynamicClients(cutoff);
      if (removed > 0) {
        ctx.logger.info(`OAuth stale client sweep: removed ${removed} unauthorized client(s)`);
      }
    },
  });
}
